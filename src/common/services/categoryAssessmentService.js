const mongoose = require("mongoose");
const { ASSESSMENT_TYPES } = require("../../constants");

const pickRandomItem = (items) =>
    !items || items.length === 0
        ? null
        : items[Math.floor(Math.random() * items.length)];

class CategoryAssessmentService {
    constructor(
        logger,
        orderService,
        {
            assessmentModel,
            scoreModel,
            questionModel,
            foreignKey,
            categoryKeys,
        },
    ) {
        this.logger = logger;
        this.orderService = orderService;
        this.assessmentModel = assessmentModel;
        this.scoreModel = scoreModel;
        this.questionModel = questionModel;
        this.foreignKey = foreignKey;
        this.categoryKeys = categoryKeys;
    }

    async create(assessment) {
        this.logger.info("Persisting a category assessment", {
            model: this.assessmentModel.modelName,
            questions: assessment.questions,
        });

        return await this.assessmentModel.create(assessment);
    }

    async findById(assessmentId) {
        return await this.assessmentModel.findById(assessmentId).lean();
    }

    async addQuestions(questions) {
        this.logger.info("Persisting category assessment questions", {
            model: this.questionModel.modelName,
            count: questions.length,
        });

        return await this.questionModel.insertMany(questions);
    }

    async findQuestions(assessmentId) {
        return await this.questionModel
            .find({ [this.foreignKey]: assessmentId })
            .select(
                "_id subCategory questionType imageQuestionDescription question optionScores isReverseScored quickAssessmentIds",
            )
            .lean();
    }

    async findScore({ userId, assessmentId, type }) {
        return await this.scoreModel
            .findOne({ userId, assessmentId, type })
            .lean();
    }

    async findFullScores(userId) {
        this.logger.info("Reading the full scores", {
            model: this.scoreModel.modelName,
            userId: String(userId),
        });

        return await this.scoreModel
            .find({ userId, type: ASSESSMENT_TYPES.FULL })
            .sort({ date: -1 })
            .lean();
    }

    async saveScore({
        userId,
        type,
        assessmentId,
        totalScore,
        byCategoryScores,
    }) {
        this.logger.info("Persisting a category assessment score", {
            model: this.scoreModel.modelName,
            userId: String(userId),
            assessmentId,
            type,
            totalScore,
        });

        return await this.scoreModel
            .findOneAndUpdate(
                { userId, type, assessmentId },
                {
                    userId,
                    type,
                    assessmentId,
                    date: new Date(),
                    totalScore,
                    byCategoryScores,
                },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            )
            .lean();
    }

    async pickForUser(userId) {
        const empty = { assessment: null, isAssessmentPurchased: false };

        if (!userId) {
            const picked = pickRandomItem(
                await this.assessmentModel.find({ active: true }).lean(),
            );

            this.logger.info("Picked an assessment for an anonymous user", {
                model: this.assessmentModel.modelName,
                found: Boolean(picked),
            });

            return picked
                ? { assessment: picked, isAssessmentPurchased: false }
                : empty;
        }

        const orderAssessmentIds =
            await this.orderService.findPurchasedAssessmentIds(userId);

        const purchased = orderAssessmentIds.length
            ? await this.assessmentModel
                  .find({ _id: { $in: orderAssessmentIds } })
                  .lean()
            : [];

        const purchasedIdSet = new Set(
            purchased.map((assessment) => String(assessment._id)),
        );

        const fullScores = await this.scoreModel
            .find({ userId, type: ASSESSMENT_TYPES.FULL })
            .select("assessmentId")
            .lean();

        const completedIdSet = new Set(
            fullScores
                .map((score) => String(score.assessmentId))
                .filter(Boolean),
        );

        const unsubmittedPurchased = purchased.filter(
            (assessment) =>
                assessment.active !== false &&
                !completedIdSet.has(String(assessment._id)),
        );

        if (unsubmittedPurchased.length > 0) {
            this.logger.info("Picked a purchased assessment", {
                model: this.assessmentModel.modelName,
                userId: String(userId),
            });

            return {
                assessment: pickRandomItem(unsubmittedPurchased),
                isAssessmentPurchased: true,
            };
        }

        const completedObjectIds = [...completedIdSet]
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        const remainingQuery = { active: true };

        if (completedObjectIds.length > 0) {
            remainingQuery._id = { $nin: completedObjectIds };
        }

        const remaining = await this.assessmentModel
            .find(remainingQuery)
            .lean();

        const picked = pickRandomItem(
            remaining.filter(
                (assessment) => !purchasedIdSet.has(String(assessment._id)),
            ),
        );

        this.logger.info("Picked a free assessment", {
            model: this.assessmentModel.modelName,
            userId: String(userId),
            found: Boolean(picked),
        });

        return picked
            ? { assessment: picked, isAssessmentPurchased: false }
            : empty;
    }

    mapScoresToLowerKeyedObject(byCategoryScores) {
        let entries;

        if (byCategoryScores instanceof Map) {
            entries = byCategoryScores.entries();
        } else if (byCategoryScores && typeof byCategoryScores === "object") {
            entries = Object.entries(byCategoryScores);
        } else {
            return {};
        }

        const lowered = {};

        for (const [key, value] of entries) {
            const parsed = Number(value);
            lowered[String(key).toLowerCase().trim()] = Number.isFinite(parsed)
                ? parsed
                : 0;
        }

        return lowered;
    }

    buildReportRow(score) {
        const lowered = this.mapScoresToLowerKeyedObject(
            score.byCategoryScores,
        );

        const byCategoryScores = Object.fromEntries(
            this.categoryKeys.map((key) => [
                key,
                Number.isFinite(lowered[key]) ? lowered[key] : 0,
            ]),
        );

        return {
            totalScore: this.categoryKeys.reduce(
                (total, key) => total + byCategoryScores[key],
                0,
            ),
            byCategoryScores,
            assessmentMeta: {
                assessmentId: score.assessmentId
                    ? String(score.assessmentId)
                    : "",
                completedAt: score.date || score.updatedAt || score.createdAt,
                reportId: String(score._id),
            },
        };
    }
}

module.exports = { CategoryAssessmentService, pickRandomItem };
