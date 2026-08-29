const {
    BADGE_NAMES,
    BADGE_THRESHOLDS,
    BADGE_CONTEXT_TYPES,
    GAME_CATEGORIES,
    ASSESSMENT_CATEGORIES,
    ASSESSMENT_TYPES,
} = require("../../constants");
const AssessmentScore = require("../assessment/assessmentScoreModel");
const Game = require("../game/gameModel");
const GameScore = require("../game/gameScoreModel");
const UserDailyActivity = require("../streak/userDailyActivityModel");
const User = require("../user/userModel");
const Badge = require("./badgeModel");
const BadgeUnlock = require("./badgeUnlockModel");
const { badges: badgeCatalogue } = require("./badgeData");

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

class BadgeService {
    constructor(logger) {
        this.logger = logger;
        this.badges = new Map();
    }

    async listActive(sort = { category: 1, rarity: 1, name: 1 }) {
        this.logger.info("Reading the active badges", { sort });

        return await Badge.find({ isActive: true }).sort(sort).lean();
    }

    async replaceCatalogue() {
        this.logger.info("Replacing the badge catalogue", {
            count: badgeCatalogue.length,
        });

        await Badge.deleteMany({});
        const createdBadges = await Badge.insertMany(badgeCatalogue);

        this.badges.clear();

        return createdBadges;
    }

    async unlockedBadgeIds(userId) {
        const unlocks = await BadgeUnlock.find({ userId })
            .populate("badgeId")
            .lean();

        return new Set(
            unlocks
                .filter((unlock) => unlock.badgeId)
                .map((unlock) => unlock.badgeId._id.toString()),
        );
    }

    async initializeBadges() {
        try {
            const badges = await Badge.find({ isActive: true }).lean();

            badges.forEach((badge) => this.badges.set(badge.name, badge));

            this.logger.info("Badge catalogue loaded", {
                count: this.badges.size,
            });
        } catch (err) {
            this.logger.error("Failed to load the badge catalogue", {
                message: err.message,
                stack: err.stack,
            });
        }
    }

    async ensureBadgesLoaded() {
        if (this.badges.size === 0) {
            await this.initializeBadges();
        }
    }

    async checkAndUnlockBadges(userId, context) {
        await this.ensureBadgesLoaded();

        this.logger.info("Checking badge criteria", {
            userId: String(userId),
            type: context.type,
        });

        try {
            const groups = await Promise.all([
                this.checkGameAchievementBadges(userId, context),
                this.checkAssessmentAchievementBadges(userId, context),
                this.checkProgressStatsBadges(userId, context),
                this.checkEngagementBadges(userId),
            ]);

            const unlockedBadges = groups.flat();

            this.logger.info("Badge criteria checked", {
                userId: String(userId),
                type: context.type,
                unlocked: unlockedBadges.map((entry) => entry.badge?.name),
            });

            return unlockedBadges;
        } catch (err) {
            this.logger.error("Badge criteria check failed", {
                userId: String(userId),
                type: context.type,
                message: err.message,
                stack: err.stack,
            });

            return [];
        }
    }

    async checkGameAchievementBadges(userId, context) {
        if (context.type !== BADGE_CONTEXT_TYPES.GAME) {
            return [];
        }

        const checks = [];

        if (context.gameCategory === GAME_CATEGORIES.LOGIC) {
            checks.push(this.checkLogicMasterBadge(userId));
        }

        if (context.gameCategory === GAME_CATEGORIES.MEMORY) {
            checks.push(this.checkMemoryMachineBadge(userId));
        }

        if (context.gameCategory === GAME_CATEGORIES.GAMEACY) {
            checks.push(this.checkReflexNinjaBadge(userId));
        }

        checks.push(this.checkStreakStarterBadge(userId));
        checks.push(this.checkGameExplorerBadge(userId));

        return this.collect(checks);
    }

    async checkAssessmentAchievementBadges(userId, context) {
        if (context.type !== BADGE_CONTEXT_TYPES.ASSESSMENT) {
            return [];
        }

        const checks = [];
        const isIqTest = context.mainCategory === ASSESSMENT_CATEGORIES.IQ_TEST;

        if (isIqTest) {
            checks.push(this.checkSmartStartBadge(userId, context));
        }

        if (isIqTest && context.iqScore >= BADGE_THRESHOLDS.BRAIN_BOOSTER_IQ) {
            checks.push(this.unlockOnce(userId, BADGE_NAMES.BRAIN_BOOSTER, {}));
        }

        if (
            isIqTest &&
            context.iqScore >= BADGE_THRESHOLDS.GENIUS_CERTIFIED_IQ
        ) {
            checks.push(
                this.unlockOnce(userId, BADGE_NAMES.GENIUS_CERTIFIED, {}),
            );
        }

        checks.push(this.checkConsistentThinkerBadge(userId));

        return this.collect(checks);
    }

    async checkProgressStatsBadges(userId, context) {
        const checks = [];

        if (
            context.type === BADGE_CONTEXT_TYPES.ASSESSMENT &&
            context.assessmentType === ASSESSMENT_TYPES.FULL
        ) {
            checks.push(
                this.unlockOnce(userId, BADGE_NAMES.FIRST_MILESTONE, {}),
            );
        }

        if (
            context.type === BADGE_CONTEXT_TYPES.ASSESSMENT &&
            context.mainCategory === ASSESSMENT_CATEGORIES.IQ_TEST
        ) {
            checks.push(this.checkImproverBadge(userId));
        }

        if (
            context.type === BADGE_CONTEXT_TYPES.ASSESSMENT ||
            context.type === BADGE_CONTEXT_TYPES.GAME
        ) {
            checks.push(this.checkTop10ChampionBadge(userId));
        }

        return this.collect(checks);
    }

    async checkEngagementBadges(userId) {
        return this.collect([this.checkBazingoBelieverBadge(userId)]);
    }

    async collect(checks) {
        const results = await Promise.all(checks);

        return results.filter(Boolean);
    }

    async pendingBadge(userId, name) {
        const badge = this.badges.get(name);

        if (!badge) {
            this.logger.warn("Badge is not seeded", { name });
            return null;
        }

        const existingUnlock = await BadgeUnlock.findOne({
            userId,
            badgeId: badge._id,
        });

        return existingUnlock ? null : badge;
    }

    async unlockOnce(userId, name, context) {
        const badge = await this.pendingBadge(userId, name);

        return badge
            ? await this.unlockBadge(userId, badge._id, context)
            : null;
    }

    async scoresInCategory(userId, category, minScore) {
        const games = await Game.find({ category }).select("_id").lean();

        return await GameScore.find({
            userId,
            gameId: { $in: games.map((game) => game._id) },
            score: { $gte: minScore },
        }).lean();
    }

    async checkLogicMasterBadge(userId) {
        const badge = await this.pendingBadge(userId, BADGE_NAMES.LOGIC_MASTER);

        if (!badge) {
            return null;
        }

        const highScores = await this.scoresInCategory(
            userId,
            GAME_CATEGORIES.LOGIC,
            BADGE_THRESHOLDS.LOGIC_MASTER_SCORE,
        );

        if (highScores.length >= BADGE_THRESHOLDS.LOGIC_MASTER_COUNT) {
            return await this.unlockBadge(userId, badge._id, {
                highScoresCount: highScores.length,
            });
        }

        return null;
    }

    async checkMemoryMachineBadge(userId) {
        const badge = await this.pendingBadge(
            userId,
            BADGE_NAMES.MEMORY_MACHINE,
        );

        if (!badge) {
            return null;
        }

        const highScores = await this.scoresInCategory(
            userId,
            GAME_CATEGORIES.MEMORY,
            BADGE_THRESHOLDS.MEMORY_MACHINE_SCORE,
        );

        if (highScores.length >= BADGE_THRESHOLDS.MEMORY_MACHINE_COUNT) {
            return await this.unlockBadge(userId, badge._id, {
                highScoresCount: highScores.length,
            });
        }

        return null;
    }

    async checkReflexNinjaBadge(userId) {
        const badge = await this.pendingBadge(userId, BADGE_NAMES.REFLEX_NINJA);

        if (!badge) {
            return null;
        }

        const games = await Game.find({ category: GAME_CATEGORIES.GAMEACY })
            .select("_id")
            .lean();
        const gameIds = games.map((game) => game._id);

        const userBestScore = await GameScore.findOne({
            userId,
            gameId: { $in: gameIds },
        })
            .sort({ score: -1 })
            .lean();

        if (!userBestScore) {
            return null;
        }

        const allScores = await GameScore.find({ gameId: { $in: gameIds } })
            .sort({ score: -1 })
            .lean();

        const rank =
            allScores.findIndex(
                (score) =>
                    score._id.toString() === userBestScore._id.toString(),
            ) + 1;
        const percentile = (rank / allScores.length) * 100;

        if (percentile <= BADGE_THRESHOLDS.REFLEX_NINJA_PERCENTILE) {
            return await this.unlockBadge(userId, badge._id, {
                percentile,
                rank,
            });
        }

        return null;
    }

    async checkStreakStarterBadge(userId) {
        const badge = await this.pendingBadge(
            userId,
            BADGE_NAMES.STREAK_STARTER,
        );

        if (!badge) {
            return null;
        }

        const required = BADGE_THRESHOLDS.STREAK_STARTER_DAYS;
        const since = new Date(Date.now() - required * MILLISECONDS_PER_DAY);

        const activities = await UserDailyActivity.find({
            userId,
            createdAt: { $gte: since },
            isGamePlayed: true,
        })
            .sort({ createdAt: 1 })
            .lean();

        if (activities.length < required) {
            return null;
        }

        const consecutiveDays = this.countConsecutiveDays(activities, required);

        if (consecutiveDays >= required) {
            return await this.unlockBadge(userId, badge._id, {
                consecutiveDays,
            });
        }

        return null;
    }

    async checkGameExplorerBadge(userId) {
        const badge = await this.pendingBadge(
            userId,
            BADGE_NAMES.GAME_EXPLORER,
        );

        if (!badge) {
            return null;
        }

        const uniqueGames = await GameScore.distinct("gameId", { userId });

        if (uniqueGames.length >= BADGE_THRESHOLDS.GAME_EXPLORER_COUNT) {
            return await this.unlockBadge(userId, badge._id, {
                uniqueGamesCount: uniqueGames.length,
            });
        }

        return null;
    }

    async checkSmartStartBadge(userId, context) {
        const badge = await this.pendingBadge(userId, BADGE_NAMES.SMART_START);

        if (!badge) {
            return null;
        }

        const previousIqTests = await AssessmentScore.find({
            userId,
            type: ASSESSMENT_TYPES.FULL,
            mainCategory: ASSESSMENT_CATEGORIES.IQ_TEST,
        }).lean();

        if (
            previousIqTests.length === 0 &&
            context.iqScore >= BADGE_THRESHOLDS.SMART_START_IQ
        ) {
            return await this.unlockBadge(userId, badge._id, {
                iqScore: context.iqScore,
            });
        }

        return null;
    }

    async checkConsistentThinkerBadge(userId) {
        const badge = await this.pendingBadge(
            userId,
            BADGE_NAMES.CONSISTENT_THINKER,
        );

        if (!badge) {
            return null;
        }

        const required = BADGE_THRESHOLDS.CONSISTENT_THINKER_DAYS;
        const since = new Date(Date.now() - required * MILLISECONDS_PER_DAY);

        const assessments = await AssessmentScore.find({
            userId,
            createdAt: { $gte: since },
        })
            .sort({ createdAt: 1 })
            .lean();

        if (assessments.length < required) {
            return null;
        }

        const consecutiveDays = this.countConsecutiveDays(
            assessments,
            required,
        );

        if (consecutiveDays >= required) {
            return await this.unlockBadge(userId, badge._id, {
                consecutiveDays,
            });
        }

        return null;
    }

    async checkImproverBadge(userId) {
        const badge = await this.pendingBadge(userId, BADGE_NAMES.IMPROVER);

        if (!badge) {
            return null;
        }

        const user = await User.findById(userId).select("iqScores").lean();

        if (!user || !user.iqScores || user.iqScores.length < 2) {
            return null;
        }

        const currentScore = user.iqScores[user.iqScores.length - 1].iqScore;
        const previousScore = user.iqScores[user.iqScores.length - 2].iqScore;
        const improvement = currentScore - previousScore;

        if (improvement >= BADGE_THRESHOLDS.IMPROVER_GAIN) {
            return await this.unlockBadge(userId, badge._id, {
                improvement,
                previousScore,
                currentScore,
            });
        }

        return null;
    }

    async checkTop10ChampionBadge(userId) {
        const badge = await this.pendingBadge(
            userId,
            BADGE_NAMES.TOP_10_CHAMPION,
        );

        if (!badge) {
            return null;
        }

        const user = await User.findById(userId)
            .select("assessmentGlobalRank gameGlobalRank")
            .lean();

        if (!user) {
            return null;
        }

        const top = BADGE_THRESHOLDS.TOP_10_CHAMPION_RANK;
        const qualifies =
            (user.assessmentGlobalRank && user.assessmentGlobalRank <= top) ||
            (user.gameGlobalRank && user.gameGlobalRank <= top);

        if (qualifies) {
            return await this.unlockBadge(userId, badge._id, {
                assessmentRank: user.assessmentGlobalRank,
                gameRank: user.gameGlobalRank,
            });
        }

        return null;
    }

    async checkBazingoBelieverBadge(userId) {
        const badge = await this.pendingBadge(
            userId,
            BADGE_NAMES.BAZINGO_BELIEVER,
        );

        if (!badge) {
            return null;
        }

        const uniqueDays = await UserDailyActivity.distinct("createdAt", {
            userId,
        });

        if (uniqueDays.length >= BADGE_THRESHOLDS.BAZINGO_BELIEVER_DAYS) {
            return await this.unlockBadge(userId, badge._id, {
                daysActive: uniqueDays.length,
            });
        }

        return null;
    }

    async unlockLeaderboardRookieBadge(userId) {
        await this.ensureBadgesLoaded();

        return await this.unlockOnce(
            userId,
            BADGE_NAMES.LEADERBOARD_ROOKIE,
            {},
        );
    }

    async unlockEarlyAdopterBadge(userId) {
        await this.ensureBadgesLoaded();

        const badge = await this.pendingBadge(
            userId,
            BADGE_NAMES.EARLY_ADOPTER,
        );

        if (!badge) {
            return null;
        }

        const userCount = await User.countDocuments();

        if (userCount <= BADGE_THRESHOLDS.EARLY_ADOPTER_USERS) {
            return await this.unlockBadge(userId, badge._id, {
                userRank: userCount,
            });
        }

        this.logger.info("User is past the early adopter window", {
            userId: String(userId),
            userCount,
        });

        return null;
    }

    async unlockBadge(userId, badgeId, context) {
        try {
            const badgeUnlock = await BadgeUnlock.create({
                userId,
                badgeId,
                context,
            });

            const badge = await Badge.findById(badgeId).lean();

            this.logger.info("Badge unlocked", {
                userId: String(userId),
                badgeId: String(badgeId),
                badgeName: badge ? badge.name : null,
            });

            return {
                badge,
                unlockedAt: badgeUnlock.unlockedAt,
                context,
            };
        } catch (err) {
            this.logger.error("Failed to unlock a badge", {
                userId: String(userId),
                badgeId: String(badgeId),
                message: err.message,
            });

            return null;
        }
    }

    countConsecutiveDays(entries, minimumLength) {
        if (entries.length < minimumLength) {
            return 0;
        }

        let consecutiveDays = 1;

        for (let index = 1; index < entries.length; index += 1) {
            const previous = new Date(entries[index - 1].createdAt);
            const current = new Date(entries[index].createdAt);
            const diffDays = Math.floor(
                (current - previous) / MILLISECONDS_PER_DAY,
            );

            if (diffDays !== 1) {
                break;
            }

            consecutiveDays += 1;
        }

        return consecutiveDays;
    }
}

module.exports = { BadgeService };
