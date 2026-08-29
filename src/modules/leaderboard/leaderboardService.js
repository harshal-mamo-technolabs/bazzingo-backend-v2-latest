const { getAgeGroup } = require("../../common/utils/ageGroup");
const {
    LEADERBOARD_RANK_FIELDS,
    LEADERBOARD_BUCKETS,
    LEADERBOARD_RANK_RECOMPUTE,
    LEADERBOARD_RANK_SORTS,
} = require("../../constants");
const Leaderboard = require("./leaderboardModel");

class LeaderboardService {
    constructor(logger) {
        this.logger = logger;
    }

    async findByUserId(userId) {
        return await Leaderboard.findOne({ userId }).lean();
    }

    async list({ filter, sort, page, limit }) {
        this.logger.info("Reading the leaderboard from the database", {
            filter,
            sort,
            page,
            limit,
        });

        const [total, results] = await Promise.all([
            Leaderboard.countDocuments(filter),
            Leaderboard.find(filter)
                .sort(sort)
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
        ]);

        this.logger.info("Leaderboard read from the database", {
            total,
            returned: results.length,
        });

        return { total, results };
    }

    async syncProfile({ userId, age, country, avatar, name }) {
        const ageGroup = age ? getAgeGroup(age) : undefined;
        const existing = await Leaderboard.findOne({ userId }).lean();

        if (existing) {
            const updates = {};

            if (country !== undefined) updates.country = country?.toLowerCase();
            if (ageGroup !== undefined) updates.ageGroup = ageGroup;
            if (avatar !== undefined) updates.avatar = avatar;
            if (name !== undefined) updates.name = name;

            if (Object.keys(updates).length > 0) {
                this.logger.info("Updating the leaderboard profile", {
                    userId: String(userId),
                    fields: Object.keys(updates),
                });

                await Leaderboard.updateOne({ userId }, { $set: updates });
            }

            return;
        }

        const ranks = await this.nextRanks({
            country: country?.toLowerCase(),
            ageGroup,
        });

        this.logger.info("Creating a leaderboard profile", {
            userId: String(userId),
            ranks,
        });

        return await Leaderboard.create({
            userId,
            country: country?.toLowerCase(),
            ageGroup,
            avatar,
            name,
            ...ranks,
            game: { totalScore: 0, category: {} },
            assessment: { totalScore: 0, category: {} },
        });
    }

    async addGameScore({ userId, category, score }) {
        return await this.addScore({
            userId,
            category,
            score,
            bucket: LEADERBOARD_BUCKETS.GAME,
        });
    }

    async addAssessmentScore({ userId, category, score }) {
        return await this.addScore({
            userId,
            category,
            score,
            bucket: LEADERBOARD_BUCKETS.ASSESSMENT,
        });
    }

    async addScore({ userId, category, score, bucket }) {
        const row = await Leaderboard.findOne({ userId })
            .select(`${bucket}.category`)
            .lean();

        const currentCategoryScore =
            (row?.[bucket]?.category && row[bucket].category[category]) || 0;

        this.logger.info("Adding a score to the leaderboard", {
            userId: String(userId),
            bucket,
            category,
            score,
        });

        await Leaderboard.updateOne(
            { userId },
            {
                $inc: { [`${bucket}.totalScore`]: score },
                $set: {
                    [`${bucket}.category.${category}`]:
                        currentCategoryScore + score,
                },
            },
        );
    }

    async nextRank(field, filter = {}) {
        const doc = await Leaderboard.findOne(filter)
            .sort({ [field]: -1 })
            .select(field)
            .lean();

        return doc ? doc[field] + 1 : 1;
    }

    async nextRanks({ country, ageGroup }) {
        const scopes = {
            [LEADERBOARD_RANK_FIELDS.GAME_GLOBAL]: {},
            [LEADERBOARD_RANK_FIELDS.ASSESSMENT_GLOBAL]: {},
            [LEADERBOARD_RANK_FIELDS.GAME_COUNTRY]: country
                ? { country }
                : null,
            [LEADERBOARD_RANK_FIELDS.ASSESSMENT_COUNTRY]: country
                ? { country }
                : null,
            [LEADERBOARD_RANK_FIELDS.GAME_AGE_GROUP]: ageGroup
                ? { ageGroup }
                : null,
            [LEADERBOARD_RANK_FIELDS.ASSESSMENT_AGE_GROUP]: ageGroup
                ? { ageGroup }
                : null,
        };

        const entries = await Promise.all(
            Object.entries(scopes).map(async ([field, filter]) => [
                field,
                filter === null ? 1 : await this.nextRank(field, filter),
            ]),
        );

        return Object.fromEntries(entries);
    }

    async recomputeRanks() {
        const baseMatch = {
            createdAt: {
                $lte: new Date(
                    Date.now() - LEADERBOARD_RANK_RECOMPUTE.MIN_AGE_MS,
                ),
            },
            isDeleted: { $ne: true },
        };

        const rankAndWrite = async ({ filter = {}, sortBy, setField }) => {
            const cursor = Leaderboard.find({ ...baseMatch, ...filter })
                .sort(sortBy)
                .select(LEADERBOARD_RANK_RECOMPUTE.SELECT)
                .cursor();

            let bulkOps = [];
            let rank = 0;

            for (
                let doc = await cursor.next();
                doc != null;
                doc = await cursor.next()
            ) {
                rank += 1;
                bulkOps.push({
                    updateOne: {
                        filter: { _id: doc._id },
                        update: { $set: { [setField]: rank } },
                    },
                });

                if (bulkOps.length >= LEADERBOARD_RANK_RECOMPUTE.BATCH_SIZE) {
                    await Leaderboard.bulkWrite(bulkOps, { ordered: false });
                    bulkOps = [];
                }
            }

            if (bulkOps.length > 0) {
                await Leaderboard.bulkWrite(bulkOps, { ordered: false });
            }

            this.logger.info("Leaderboard ranks written", {
                setField,
                filter,
                ranked: rank,
            });
        };

        this.logger.info("Recomputing the leaderboard ranks");

        await rankAndWrite({
            sortBy: LEADERBOARD_RANK_SORTS.GAME,
            setField: LEADERBOARD_RANK_FIELDS.GAME_GLOBAL,
        });
        await rankAndWrite({
            sortBy: LEADERBOARD_RANK_SORTS.ASSESSMENT,
            setField: LEADERBOARD_RANK_FIELDS.ASSESSMENT_GLOBAL,
        });

        const countries = await Leaderboard.distinct("country", {
            ...baseMatch,
            country: { $exists: true, $ne: null },
        });

        for (const country of countries) {
            await rankAndWrite({
                filter: { country },
                sortBy: LEADERBOARD_RANK_SORTS.GAME,
                setField: LEADERBOARD_RANK_FIELDS.GAME_COUNTRY,
            });
            await rankAndWrite({
                filter: { country },
                sortBy: LEADERBOARD_RANK_SORTS.ASSESSMENT,
                setField: LEADERBOARD_RANK_FIELDS.ASSESSMENT_COUNTRY,
            });
        }

        const ageGroups = await Leaderboard.distinct("ageGroup", {
            ...baseMatch,
            ageGroup: { $exists: true, $ne: null },
        });

        for (const ageGroup of ageGroups) {
            await rankAndWrite({
                filter: { ageGroup },
                sortBy: LEADERBOARD_RANK_SORTS.GAME,
                setField: LEADERBOARD_RANK_FIELDS.GAME_AGE_GROUP,
            });
            await rankAndWrite({
                filter: { ageGroup },
                sortBy: LEADERBOARD_RANK_SORTS.ASSESSMENT,
                setField: LEADERBOARD_RANK_FIELDS.ASSESSMENT_AGE_GROUP,
            });
        }

        this.logger.info("Leaderboard ranks recomputed", {
            countries: countries.length,
            ageGroups: ageGroups.length,
        });
    }
}

module.exports = { LeaderboardService };
