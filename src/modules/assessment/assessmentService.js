const {
    ASSESSMENT_TYPES,
    ORDER_STATUSES,
    ASSESSMENT_AGE_GROUPS,
    UNKNOWN_AGE_GROUP,
    IQ_CALIBRATION,
    ASSESSMENT_DEFAULTS,
    LEGACY_SCORE_CATEGORIES,
} = require("../../constants");
const Order = require("../stripe/orderModel");
const User = require("../user/userModel");
const AssessmentScore = require("./assessmentScoreModel");
const FullAssessment = require("./fullAssessmentModel");
const QuestionAndAnswer = require("./questionAndAnswerModel");
const QuickMiniAssessment = require("./quickMiniAssessmentModel");

const getAssessmentAgeGroup = (age) => {
    if (!age) {
        return UNKNOWN_AGE_GROUP;
    }

    const range = ASSESSMENT_AGE_GROUPS.find(
        (group) => age >= group.min && age <= group.max,
    );

    return range ? range.label : UNKNOWN_AGE_GROUP;
};

class AssessmentService {
    constructor(logger) {
        this.logger = logger;
    }

    async createFullAssessment(assessment) {
        this.logger.info("Persisting a full assessment", {
            mainCategory: assessment.mainCategory,
        });

        return await FullAssessment.create(assessment);
    }

    async findFullAssessmentById(assessmentId, select) {
        const query = FullAssessment.findById(assessmentId);

        return await (select ? query.select(select) : query).lean();
    }

    async findActiveCategories() {
        return await FullAssessment.distinct("mainCategory", { active: true });
    }

    async findActiveByCategory(mainCategory, select) {
        const query = FullAssessment.find({ mainCategory, active: true });

        return await (select ? query.select(select) : query).lean();
    }

    async addQuestions(questions) {
        this.logger.info("Persisting assessment questions", {
            count: questions.length,
        });

        return await QuestionAndAnswer.insertMany(questions);
    }

    async findQuestionsByAssessment(fullAssessment, select) {
        return await QuestionAndAnswer.find({ fullAssessment })
            .select(select)
            .lean();
    }

    async findQuestionsByIds(ids, select) {
        return await QuestionAndAnswer.find({ _id: { $in: ids } })
            .select(select)
            .lean();
    }

    async findQuickMiniById(assessmentId, select) {
        const query = QuickMiniAssessment.findById(assessmentId);

        return await (select ? query.select(select) : query).lean();
    }

    async findScore(filter) {
        return await AssessmentScore.findOne(filter).lean();
    }

    async findFullAssessments(ids, select) {
        return await FullAssessment.find({ _id: { $in: ids } })
            .select(select)
            .lean();
    }

    async findActiveExcluding(excludedIds, select) {
        const filter = { active: true };

        if (excludedIds.length > 0) {
            filter._id = { $nin: excludedIds };
        }

        return await FullAssessment.find(filter).select(select).lean();
    }

    async attachPrice(assessmentId, priceId) {
        this.logger.info("Attaching a price to an assessment", {
            assessmentId: String(assessmentId),
            priceId: String(priceId),
        });

        return await FullAssessment.findByIdAndUpdate(assessmentId, {
            priceId,
        });
    }

    async findPurchasedAssessments(userId) {
        const orders = await Order.find({
            userId,
            status: ORDER_STATUSES.SUCCEEDED,
            assessmentId: { $exists: true },
        })
            .populate("assessmentId")
            .lean();

        return orders
            .filter((order) => order.assessmentId)
            .map((order) => order.assessmentId);
    }

    async findScoreById(scoreId) {
        return await AssessmentScore.findById(scoreId).lean();
    }

    async findScores(filter, { sort, limit } = {}) {
        let query = AssessmentScore.find(filter);

        if (sort) {
            query = query.sort(sort);
        }

        if (limit) {
            query = query.limit(limit);
        }

        return await query.lean();
    }

    async saveScore({
        userId,
        type,
        assessmentId,
        mainCategory,
        date,
        totalScore,
        byCategory,
    }) {
        this.logger.info("Persisting an assessment score", {
            userId: String(userId),
            type,
            assessmentId: String(assessmentId),
            totalScore,
        });

        return await AssessmentScore.findOneAndUpdate(
            { userId, type, assessmentId },
            {
                userId,
                type,
                assessmentId,
                mainCategory,
                date,
                totalScore,
                byCategory,
            },
            { upsert: true, new: true },
        );
    }

    async setProgramScoreOnScore(scoreId, programScore) {
        return await AssessmentScore.findByIdAndUpdate(scoreId, {
            programScore,
        });
    }

    scoreAnswers({ questionDocs, answers }) {
        const byId = new Map(
            questionDocs.map((question) => [String(question._id), question]),
        );

        let total = 0;
        const byCategory = {};

        for (const answer of answers) {
            const question = byId.get(String(answer.questionId));

            if (!question) {
                continue;
            }

            const points =
                answer.chosenIndex === question.answerIndex
                    ? question.points || ASSESSMENT_DEFAULTS.POINTS
                    : 0;

            total += points;
            byCategory[question.subcategory] =
                (byCategory[question.subcategory] || 0) + points;
        }

        return {
            total,
            byCategory,
            outOfScore: this.computeOutOfScore(questionDocs),
        };
    }

    computeOutOfScore(questionDocs) {
        return questionDocs.reduce(
            (sum, question) =>
                sum + (question.points || ASSESSMENT_DEFAULTS.POINTS),
            0,
        );
    }

    calculateIQScore(assessmentScore, ageGroupScores) {
        if (ageGroupScores.length < IQ_CALIBRATION.SAMPLE_THRESHOLD) {
            return Math.round(
                IQ_CALIBRATION.BASE_OFFSET +
                    (assessmentScore / IQ_CALIBRATION.BASE_DIVISOR) *
                        IQ_CALIBRATION.BASE_RANGE,
            );
        }

        const scores = ageGroupScores.map((score) => score.totalScore);
        const average =
            scores.reduce((sum, score) => sum + score, 0) / scores.length;
        const variance =
            scores.reduce(
                (sum, score) => sum + Math.pow(score - average, 2),
                0,
            ) / scores.length;
        const spread = Math.sqrt(variance);

        if (spread === 0) {
            return IQ_CALIBRATION.MEAN;
        }

        const iqScore =
            IQ_CALIBRATION.MEAN +
            IQ_CALIBRATION.STANDARD_DEVIATION *
                ((assessmentScore - average) / spread);

        return Math.round(
            Math.max(IQ_CALIBRATION.MIN, Math.min(IQ_CALIBRATION.MAX, iqScore)),
        );
    }

    async findAgeGroupScores(ageGroup, mainCategory) {
        const allScores = await AssessmentScore.find({
            type: ASSESSMENT_TYPES.FULL,
            date: { $exists: true },
        })
            .populate({
                path: "userId",
                select: "age",
                match: { age: { $exists: true } },
            })
            .lean();

        const sameAgeGroup = allScores.filter(
            (score) =>
                score.userId &&
                score.userId.age &&
                getAssessmentAgeGroup(score.userId.age) === ageGroup,
        );

        const matching = [];

        for (const score of sameAgeGroup) {
            const assessment = await FullAssessment.findById(score.assessmentId)
                .select("mainCategory")
                .lean();

            if (assessment && assessment.mainCategory === mainCategory) {
                matching.push(score);
            }
        }

        return matching;
    }

    async updateUserProgramScore(
        userId,
        mainCategory,
        programScore,
        assessmentScore,
    ) {
        try {
            const user = await User.findById(userId);

            if (!user) {
                this.logger.warn("User not found for a program score update", {
                    userId: String(userId),
                });
                return;
            }

            if (!user.programScore) {
                user.programScore = new Map();
            }

            const scoreEntry = {
                programScore,
                date: new Date(),
                assessmentScore,
            };

            if (user.programScore.has(mainCategory)) {
                const categoryData = user.programScore.get(mainCategory);
                categoryData.programScore = programScore;
                categoryData.scores = categoryData.scores || [];
                categoryData.scores.push(scoreEntry);
                user.programScore.set(mainCategory, categoryData);
            } else {
                user.programScore.set(mainCategory, {
                    programScore,
                    scores: [scoreEntry],
                });
            }

            await user.save();

            this.logger.info("Program score updated", {
                userId: String(userId),
                mainCategory,
                programScore,
            });
        } catch (err) {
            this.logger.error("Program score update failed", {
                userId: String(userId),
                mainCategory,
                message: err.message,
                stack: err.stack,
            });
        }
    }

    async pushLegacyScore({
        userId,
        mainCategory,
        programScore,
        total,
        date,
        ageGroup,
    }) {
        if (mainCategory === LEGACY_SCORE_CATEGORIES.IQ_TEST) {
            await User.findByIdAndUpdate(userId, {
                $push: {
                    iqScores: {
                        date,
                        iqScore: programScore,
                        assessmentScore: total,
                        ageGroup,
                    },
                },
                $set: { iq: programScore },
            });
        }

        if (mainCategory === LEGACY_SCORE_CATEGORIES.DRIVING_LICENCE) {
            await User.findByIdAndUpdate(userId, {
                $push: {
                    drivingLicenseScores: {
                        date,
                        drivingLicenseScore: programScore,
                        assessmentScore: total,
                        ageGroup,
                    },
                },
                $set: { drivingLicense: programScore },
            });
        }
    }

    toPlainObject(value) {
        if (!value) {
            return {};
        }

        if (value instanceof Map || typeof value.entries === "function") {
            return Object.fromEntries(value.entries());
        }

        return typeof value === "object" ? value : {};
    }
}

module.exports = { AssessmentService, getAssessmentAgeGroup };
