const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const { getCETMidnight } = require("../../common/utils/time");
const {
    RESPONSE_STATUS,
    ASSESSMENT_TYPES,
    ASSESSMENT_DEFAULTS,
    ASSESSMENT_STAT_PERIODS,
    BADGE_CONTEXT_TYPES,
    LEGACY_SCORE_CATEGORIES,
    ORDER_STATUSES,
    SUBSCRIPTION_ACTIVE_STATUSES,
    PLAN_DURATIONS,
    FULL_ASSESSMENT_MESSAGES,
} = require("../../constants");
const DailyChallenge = require("../game/dailyChallengeModel");
const PriceCatalog = require("../price-catalog/priceCatalogModel");
const Plan = require("../plan/planModel");
const Order = require("../stripe/orderModel");
const { unusedPurchaseIds } = require("../../common/utils/entitlements");
const Subscription = require("../stripe/subscriptionModel");
const User = require("../user/userModel");
const { getAssessmentAgeGroup } = require("./assessmentService");

const QUESTION_SELECT =
    "_id subcategory questionType imageQuestionDescription question optionsType options answerIndex points";
const SCORING_SELECT = "_id subcategory answerIndex points";
const RECOMMENDATION_SELECT =
    "_id mainCategory title description questions subcategories isAvailReport isAvailCertification stripeProductId";

const pickRandomItem = (items) =>
    !items || items.length === 0
        ? null
        : items[Math.floor(Math.random() * items.length)];

class AssessmentController {
    constructor(
        assessmentService,
        leaderboardService,
        badgeService,
        streakService,
        adhdAssessmentService,
        eiAssessmentService,
        generateQuickMinis,
        logger,
    ) {
        this.assessmentService = assessmentService;
        this.leaderboardService = leaderboardService;
        this.badgeService = badgeService;
        this.streakService = streakService;
        this.adhdAssessmentService = adhdAssessmentService;
        this.eiAssessmentService = eiAssessmentService;
        this.generateQuickMinis = generateQuickMinis;
        this.logger = logger;
    }

    async createFullAssessment(req, res, next) {
        const {
            mainCategory,
            questions,
            fixedPoint,
            subcategories,
            title,
            description,
            stripeProductId,
            isAvailReport = true,
            isAvailCertification = false,
        } = req.body;

        this.logger.info("Request to create a full assessment", {
            requestId: req.requestId,
            mainCategory,
        });

        if (
            !mainCategory ||
            (questions !== 0 && !questions) ||
            !Array.isArray(subcategories) ||
            subcategories.length === 0
        ) {
            return next(
                createHttpError(400, FULL_ASSESSMENT_MESSAGES.CREATE_REQUIRED),
            );
        }

        const questionsCount = Number(questions);

        if (!Number.isFinite(questionsCount) || questionsCount < 1) {
            return next(
                createHttpError(400, "questions must be a number >= 1"),
            );
        }

        if (
            typeof stripeProductId !== "string" ||
            stripeProductId.trim() === ""
        ) {
            return next(
                createHttpError(
                    400,
                    FULL_ASSESSMENT_MESSAGES.STRIPE_PRODUCT_REQUIRED,
                ),
            );
        }

        const assessment = await this.assessmentService.createFullAssessment({
            mainCategory: String(mainCategory).trim().toLowerCase(),
            title: title || "",
            description: description || "",
            questions: questionsCount,
            fixedPoint: fixedPoint || ASSESSMENT_DEFAULTS.FIXED_POINT,
            subcategories,
            stripeProductId: stripeProductId.trim(),
            isAvailReport,
            isAvailCertification,
        });

        this.logger.info("Full assessment created", {
            requestId: req.requestId,
            assessmentId: String(assessment._id),
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.CREATED,
            data: { assessment },
        });
    }

    async addFullAssessmentQuestions(req, res, next) {
        const { fullAssessmentId } = req.params;
        const { questions } = req.body;

        this.logger.info("Request to add full assessment questions", {
            requestId: req.requestId,
            fullAssessmentId,
        });

        if (!Array.isArray(questions) || questions.length === 0) {
            return next(createHttpError(400, "questions array is required"));
        }

        const assessment =
            await this.assessmentService.findFullAssessmentById(
                fullAssessmentId,
            );

        if (!assessment) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.NOT_FOUND),
            );
        }

        const allowedSubs = new Set(
            (assessment.subcategories || []).map((sub) => String(sub)),
        );

        const prepared = questions.map((question, index) => {
            if (
                !question.subcategory ||
                !allowedSubs.has(String(question.subcategory))
            ) {
                throw createHttpError(
                    400,
                    `Invalid subcategory at index ${index}`,
                );
            }

            if (
                !question.questionType ||
                !question.question ||
                !question.optionsType ||
                !Array.isArray(question.options) ||
                question.options.length !== 4
            ) {
                throw createHttpError(
                    400,
                    `Invalid question payload at index ${index}`,
                );
            }

            if (
                typeof question.answerIndex !== "number" ||
                question.answerIndex < 0 ||
                question.answerIndex > 3
            ) {
                throw createHttpError(
                    400,
                    `Invalid answerIndex at index ${index}`,
                );
            }

            const rawDescription = question.imageQuestionDescription;

            return {
                fullAssessment: fullAssessmentId,
                subcategory: question.subcategory,
                questionType: question.questionType,
                imageQuestionDescription:
                    rawDescription == null ||
                    (typeof rawDescription === "string" &&
                        rawDescription.trim() === "")
                        ? null
                        : String(rawDescription).trim(),
                question: question.question,
                optionsType: question.optionsType,
                options: question.options,
                answerIndex: question.answerIndex,
                points: question.points ?? assessment.fixedPoint,
            };
        });

        const inserted = await this.assessmentService.addQuestions(prepared);

        this.logger.info("Full assessment questions added", {
            requestId: req.requestId,
            fullAssessmentId,
            count: inserted.length,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.QUESTIONS_ADDED,
            data: { count: inserted.length },
        });
    }

    async generateQuickMiniAssessments(req, res) {
        const { fullAssessmentId } = req.params;
        const numberOfMinis = Math.max(
            parseInt(req.query.count, 10) || ASSESSMENT_DEFAULTS.QUICK_MINIS,
            1,
        );

        this.logger.info("Request to generate quick mini assessments", {
            requestId: req.requestId,
            fullAssessmentId,
            numberOfMinis,
        });

        const result = await this.generateQuickMinis({
            fullAssessmentId,
            numberOfMinis,
        });

        this.logger.info("Quick mini assessments generated", {
            requestId: req.requestId,
            fullAssessmentId,
            createdCount: result.createdCount,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.QUICK_MINIS_GENERATED,
            data: result,
        });
    }

    async getFullAssessmentById(req, res, next) {
        const { id } = req.params;

        this.logger.info("Request to read a full assessment", {
            requestId: req.requestId,
            assessmentId: id,
        });

        const assessment =
            await this.assessmentService.findFullAssessmentById(id);

        if (!assessment) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.NOT_FOUND),
            );
        }

        const questions =
            await this.assessmentService.findQuestionsByAssessment(
                id,
                QUESTION_SELECT,
            );

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.FETCHED,
            data: { assessment, questions },
        });
    }

    async getQuickMiniAssessmentById(req, res, next) {
        const { id } = req.params;

        this.logger.info("Request to read a quick mini assessment", {
            requestId: req.requestId,
            assessmentId: id,
        });

        const mini = await this.assessmentService.findQuickMiniById(
            id,
            "_id fullAssessment questions size order createdAt",
        );

        if (!mini) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.QUICK_NOT_FOUND),
            );
        }

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.QUICK_FETCHED,
            data: {
                assessment: mini,
                questions: await this.orderedQuestions(mini.questions),
            },
        });
    }

    async orderedQuestions(questionIds) {
        const questionDocs = await this.assessmentService.findQuestionsByIds(
            questionIds,
            QUESTION_SELECT,
        );

        const byId = new Map(
            questionDocs.map((question) => [String(question._id), question]),
        );

        return questionIds.map((id) => byId.get(String(id))).filter(Boolean);
    }

    async getTodaysAssignedQuick(req, res, next) {
        const today = getCETMidnight(new Date());
        const userId = req.user._id;

        this.logger.info("Request to read today's quick assessment", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const assigned = await DailyChallenge.findOne({ date: today }).lean();

        if (!assigned) {
            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: FULL_ASSESSMENT_MESSAGES.NO_QUICK_TODAY,
                data: { assessment: null, questions: [], isCompleted: false },
            });
        }

        const mini = await this.assessmentService.findQuickMiniById(
            assigned.quickAssessmentId,
            "_id fullAssessment questions size order createdAt",
        );

        if (!mini) {
            return next(
                createHttpError(
                    404,
                    FULL_ASSESSMENT_MESSAGES.ASSIGNED_QUICK_NOT_FOUND,
                ),
            );
        }

        const fullAssessment =
            await this.assessmentService.findFullAssessmentById(
                mini.fullAssessment,
                "title description mainCategory",
            );

        if (!fullAssessment) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.NOT_FOUND),
            );
        }

        const existingScore = await this.assessmentService.findScore({
            userId,
            type: ASSESSMENT_TYPES.QUICK,
            assessmentId: assigned.quickAssessmentId,
            date: today,
        });

        this.logger.info("Today's quick assessment sent", {
            requestId: req.requestId,
            userId: String(userId),
            isCompleted: Boolean(existingScore),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.TODAYS_QUICK,
            data: {
                assessment: {
                    ...mini,
                    title: fullAssessment.title,
                    description: fullAssessment.description,
                    mainCategory: fullAssessment.mainCategory,
                },
                questions: await this.orderedQuestions(mini.questions),
                isCompleted: Boolean(existingScore),
                completedScore: existingScore ? existingScore.totalScore : null,
            },
        });
    }

    async submitAssessmentScore(req, res, next) {
        const { type, assessmentId, answers } = req.body;
        const userId = req.user._id;

        this.logger.info("Request to submit an assessment score", {
            requestId: req.requestId,
            userId: String(userId),
            type,
            assessmentId,
        });

        if (![ASSESSMENT_TYPES.QUICK, ASSESSMENT_TYPES.FULL].includes(type)) {
            return next(
                createHttpError(400, FULL_ASSESSMENT_MESSAGES.INVALID_TYPE),
            );
        }

        if (!assessmentId || !Array.isArray(answers)) {
            return next(
                createHttpError(400, FULL_ASSESSMENT_MESSAGES.SUBMIT_REQUIRED),
            );
        }

        const today = getCETMidnight(new Date());
        let questionDocs = [];

        if (type === ASSESSMENT_TYPES.QUICK) {
            const mini =
                await this.assessmentService.findQuickMiniById(assessmentId);

            if (!mini) {
                return next(
                    createHttpError(
                        404,
                        FULL_ASSESSMENT_MESSAGES.QUICK_NOT_FOUND,
                    ),
                );
            }

            questionDocs = await this.assessmentService.findQuestionsByIds(
                mini.questions,
                SCORING_SELECT,
            );
        } else {
            questionDocs =
                await this.assessmentService.findQuestionsByAssessment(
                    assessmentId,
                    SCORING_SELECT,
                );

            if (questionDocs.length === 0) {
                return next(
                    createHttpError(
                        404,
                        FULL_ASSESSMENT_MESSAGES.QUESTIONS_NOT_FOUND,
                    ),
                );
            }
        }

        const { total, byCategory, outOfScore } =
            this.assessmentService.scoreAnswers({ questionDocs, answers });

        return type === ASSESSMENT_TYPES.QUICK
            ? await this.submitQuickScore({
                  req,
                  res,
                  userId,
                  assessmentId,
                  today,
                  total,
                  byCategory,
                  outOfScore,
              })
            : await this.submitFullScore({
                  req,
                  res,
                  userId,
                  assessmentId,
                  today,
                  total,
                  byCategory,
                  outOfScore,
                  type,
              });
    }

    async resolveQuickMainCategory(assessmentId) {
        try {
            const mini = await this.assessmentService.findQuickMiniById(
                assessmentId,
                "fullAssessment",
            );

            if (mini?.fullAssessment) {
                const full =
                    await this.assessmentService.findFullAssessmentById(
                        mini.fullAssessment,
                        "mainCategory",
                    );

                return full?.mainCategory || ASSESSMENT_DEFAULTS.MAIN_CATEGORY;
            }
        } catch (err) {
            this.logger.error("Failed to resolve the quick main category", {
                assessmentId: String(assessmentId),
                message: err.message,
            });
        }

        return ASSESSMENT_DEFAULTS.MAIN_CATEGORY;
    }

    async submitQuickScore({
        req,
        res,
        userId,
        assessmentId,
        today,
        total,
        byCategory,
        outOfScore,
    }) {
        const todaysAssignment = await DailyChallenge.findOne({
            date: today,
        }).lean();

        const isTodayAssigned = Boolean(
            todaysAssignment &&
            String(todaysAssignment.quickAssessmentId) === String(assessmentId),
        );

        const mainCategory = await this.resolveQuickMainCategory(assessmentId);

        const score = await this.assessmentService.saveScore({
            userId,
            type: ASSESSMENT_TYPES.QUICK,
            assessmentId,
            mainCategory,
            date: today,
            totalScore: total,
            byCategory,
        });

        await this.addLeaderboardScore({ userId, mainCategory, total });

        if (isTodayAssigned) {
            await this.streakService.markAssessmentCompleted({
                userId,
                date: today,
            });
        }

        this.logger.info("Quick assessment score submitted", {
            requestId: req.requestId,
            userId: String(userId),
            isTodayAssigned,
            totalScore: total,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: isTodayAssigned
                ? FULL_ASSESSMENT_MESSAGES.QUICK_SUBMITTED_ASSIGNED
                : FULL_ASSESSMENT_MESSAGES.QUICK_SUBMITTED_UNASSIGNED,
            data: {
                score,
                outOfScore,
                isResubmission: false,
                isTodayAssigned,
            },
        });
    }

    async addLeaderboardScore({ userId, mainCategory, total }) {
        try {
            await this.leaderboardService.addAssessmentScore({
                userId,
                category: mainCategory,
                score: total,
            });
        } catch (err) {
            this.logger.error("Leaderboard assessment score failed", {
                userId: String(userId),
                mainCategory,
                message: err.message,
            });
        }
    }

    async submitFullScore({
        req,
        res,
        userId,
        assessmentId,
        today,
        total,
        byCategory,
        outOfScore,
        type,
    }) {
        const full = await this.assessmentService.findFullAssessmentById(
            assessmentId,
            "mainCategory",
        );
        const mainCategory =
            full?.mainCategory || ASSESSMENT_DEFAULTS.MAIN_CATEGORY;

        const score = await this.assessmentService.saveScore({
            userId,
            type: ASSESSMENT_TYPES.FULL,
            assessmentId,
            mainCategory,
            date: today,
            totalScore: total,
            byCategory,
        });

        await this.addLeaderboardScore({ userId, mainCategory, total });
        await this.applyProgramScore({
            req,
            userId,
            mainCategory,
            total,
            today,
            scoreId: score._id,
        });

        const unlockedBadges = await this.unlockBadges({
            req,
            userId,
            type,
            mainCategory,
            total,
        });

        this.logger.info("Full assessment score submitted", {
            requestId: req.requestId,
            userId: String(userId),
            mainCategory,
            totalScore: total,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.FULL_SUBMITTED,
            data: {
                score,
                outOfScore,
                isResubmission: false,
                unlockedBadges,
            },
        });
    }

    async applyProgramScore({
        req,
        userId,
        mainCategory,
        total,
        today,
        scoreId,
    }) {
        if (!mainCategory) {
            return;
        }

        try {
            const user = await User.findById(userId).select("age").lean();
            const ageGroup = getAssessmentAgeGroup(user?.age);

            const ageGroupScores =
                await this.assessmentService.findAgeGroupScores(
                    ageGroup,
                    mainCategory,
                );

            const programScore = this.assessmentService.calculateIQScore(
                total,
                ageGroupScores,
            );

            await this.assessmentService.setProgramScoreOnScore(
                scoreId,
                programScore,
            );

            await this.assessmentService.updateUserProgramScore(
                userId,
                mainCategory,
                programScore,
                total,
            );

            await this.assessmentService.pushLegacyScore({
                userId,
                mainCategory,
                programScore,
                total,
                date: today,
                ageGroup,
            });

            this.logger.info("Program score applied", {
                requestId: req.requestId,
                userId: String(userId),
                mainCategory,
                programScore,
                ageGroup,
            });
        } catch (err) {
            this.logger.error("Program score calculation failed", {
                requestId: req.requestId,
                userId: String(userId),
                mainCategory,
                message: err.message,
                stack: err.stack,
            });
        }
    }

    async unlockBadges({ req, userId, type, mainCategory, total }) {
        try {
            const iqScore =
                type === ASSESSMENT_TYPES.FULL &&
                mainCategory === LEGACY_SCORE_CATEGORIES.IQ_TEST
                    ? (await User.findById(userId).select("iq").lean())?.iq
                    : null;

            return await this.badgeService.checkAndUnlockBadges(userId, {
                type: BADGE_CONTEXT_TYPES.ASSESSMENT,
                assessmentType: type,
                mainCategory,
                totalScore: total,
                iqScore,
            });
        } catch (err) {
            this.logger.error("Badge check after an assessment failed", {
                requestId: req.requestId,
                userId: String(userId),
                message: err.message,
            });

            return [];
        }
    }

    async getLatestAssessmentScores(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the latest assessment scores", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const latestScores = await this.assessmentService.findScores(
            { userId },
            {
                sort: { createdAt: -1 },
                limit: ASSESSMENT_DEFAULTS.LATEST_SCORES_LIMIT,
            },
        );

        const scores = await Promise.all(
            latestScores.map(async (score) => {
                let assessmentName = ASSESSMENT_DEFAULTS.UNKNOWN_ASSESSMENT;
                let outOfScore = 0;

                if (score.type === ASSESSMENT_TYPES.QUICK) {
                    const quickMini =
                        await this.assessmentService.findQuickMiniById(
                            score.assessmentId,
                            "questions",
                        );

                    if (quickMini) {
                        outOfScore =
                            quickMini.questions.length *
                            ASSESSMENT_DEFAULTS.POINTS;
                        assessmentName =
                            ASSESSMENT_DEFAULTS.QUICK_ASSESSMENT_NAME;
                    }
                } else if (score.type === ASSESSMENT_TYPES.FULL) {
                    const fullAssessment =
                        await this.assessmentService.findFullAssessmentById(
                            score.assessmentId,
                            "title mainCategory questions fixedPoint",
                        );

                    if (fullAssessment) {
                        assessmentName =
                            fullAssessment.title ||
                            `${fullAssessment.mainCategory} Assessment`;
                        outOfScore =
                            fullAssessment.questions *
                            fullAssessment.fixedPoint;
                    }
                }

                return {
                    assessmentName,
                    totalScore: score.totalScore,
                    outOfScore,
                    type: score.type,
                    submittedAt: score.createdAt,
                };
            }),
        );

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.LATEST_SCORES,
            data: { total: scores.length, scores },
        });
    }

    async attachAssessmentPrice(req, res, next) {
        const { assessmentId, priceCatalogId } = req.body || {};

        this.logger.info("Request to attach a price to an assessment", {
            requestId: req.requestId,
            assessmentId,
            priceCatalogId,
        });

        if (!assessmentId || !priceCatalogId) {
            return next(
                createHttpError(400, FULL_ASSESSMENT_MESSAGES.ATTACH_REQUIRED),
            );
        }

        const assessment =
            await this.assessmentService.findFullAssessmentById(assessmentId);

        if (!assessment) {
            return next(
                createHttpError(
                    404,
                    FULL_ASSESSMENT_MESSAGES.ASSESSMENT_NOT_FOUND,
                ),
            );
        }

        const price = await PriceCatalog.findById(priceCatalogId);

        if (!price) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.PRICE_NOT_FOUND),
            );
        }

        if (!price.assessmentId) {
            return next(
                createHttpError(
                    400,
                    FULL_ASSESSMENT_MESSAGES.PRICE_NOT_ASSESSMENT,
                ),
            );
        }

        if (String(price.assessmentId) !== String(assessment._id)) {
            return next(
                createHttpError(
                    400,
                    FULL_ASSESSMENT_MESSAGES.PRICE_WRONG_ASSESSMENT,
                ),
            );
        }

        if (price.type !== "one_time") {
            return next(
                createHttpError(
                    400,
                    FULL_ASSESSMENT_MESSAGES.PRICE_NOT_ONE_TIME,
                ),
            );
        }

        await this.assessmentService.attachPrice(assessment._id, price._id);

        this.logger.info("Price attached to an assessment", {
            requestId: req.requestId,
            assessmentId: String(assessment._id),
            priceCatalogId: String(price._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.PRICE_ATTACHED,
            data: {
                assessmentId: assessment._id,
                priceCatalogId: price._id,
            },
        });
    }

    async getUserProgramScores(req, res, next) {
        const userId = req.user._id;

        this.logger.info("Request to read the user program scores", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const availableCategories =
            await this.assessmentService.findActiveCategories();

        const user = await User.findById(userId)
            .select(
                "iq iqScores drivingLicense drivingLicenseScores age userFunnelAssessmentCategory programScore",
            )
            .lean();

        if (!user) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.USER_NOT_FOUND),
            );
        }

        const programScoreObject = this.assessmentService.toPlainObject(
            user.programScore,
        );

        const programScore = Object.fromEntries(
            availableCategories.map((category) => [
                category,
                programScoreObject[category] &&
                programScoreObject[category].programScore !== undefined
                    ? {
                          programScore:
                              programScoreObject[category].programScore,
                          scores: programScoreObject[category].scores || [],
                      }
                    : { programScore: 0, scores: [] },
            ]),
        );

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.PROGRAM_SCORES,
            data: { programScore, availableCategories },
        });
    }

    async getUserProgramScoresOnly(req, res, next) {
        const userId = req.user._id;

        this.logger.info("Request to read the program scores only", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const user = await User.findById(userId).select("programScore").lean();

        if (!user) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.USER_NOT_FOUND),
            );
        }

        const programScoreObject = this.assessmentService.toPlainObject(
            user.programScore,
        );

        const categoryScores = {};

        for (const [category, data] of Object.entries(programScoreObject)) {
            if (
                data &&
                typeof data === "object" &&
                data.programScore !== undefined
            ) {
                categoryScores[category] = data.programScore;
            }
        }

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.PROGRAM_SCORES,
            data: categoryScores,
        });
    }

    async getAssessmentScorePublic(req, res, next) {
        const { scoreId } = req.params;

        this.logger.info("Request to read a public assessment score", {
            requestId: req.requestId,
            scoreId,
        });

        const score = await this.assessmentService.findScoreById(scoreId);

        if (!score) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.SCORE_NOT_FOUND),
            );
        }

        const user = await User.findById(score.userId)
            .select("name age")
            .lean();

        const fullAssessment =
            await this.assessmentService.findFullAssessmentById(
                score.assessmentId,
                "mainCategory",
            );

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.SCORE_FETCHED,
            data: {
                score: {
                    _id: score._id,
                    userId: score.userId,
                    type: score.type,
                    assessmentId: score.assessmentId,
                    date: score.date,
                    totalScore: score.totalScore,
                    byCategory: this.assessmentService.toPlainObject(
                        score.byCategory,
                    ),
                    userName: user?.name || null,
                    userAge: typeof user?.age === "number" ? user.age : null,
                    mainCategory: fullAssessment?.mainCategory || null,
                    createdAt: score.createdAt,
                    updatedAt: score.updatedAt,
                },
            },
        });
    }

    async getUserSubscriptionAndAssessments(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the subscription and assessments", {
            requestId: req.requestId,
            userId: String(userId),
        });

        let subscription = {
            isActive: false,
            planName: null,
            planId: null,
            isTrial: false,
            planDuration: null,
        };

        try {
            const sub = await Subscription.findOne({ userId })
                .sort({ currentPeriodEnd: -1 })
                .lean();

            if (sub) {
                const status = String(sub.status || "").toLowerCase();
                const isActive = SUBSCRIPTION_ACTIVE_STATUSES.includes(status);
                const isTrial =
                    status === "trialing" ||
                    Boolean(
                        sub.trialEnd && new Date(sub.trialEnd) > new Date(),
                    );

                let planDoc = null;
                let planIdOut = sub.planId || null;

                if (sub.planId) {
                    planDoc = await Plan.findById(sub.planId)
                        .select("name")
                        .lean();
                }

                if (!planDoc && sub.priceCatalogId) {
                    const price = await PriceCatalog.findById(
                        sub.priceCatalogId,
                    )
                        .select("planId")
                        .lean();

                    if (price?.planId) {
                        planDoc = await Plan.findById(price.planId)
                            .select("name")
                            .lean();
                        planIdOut = price.planId?.toString?.() || planIdOut;
                    }
                }

                const duration = sub.planDuration
                    ? String(sub.planDuration).toLowerCase()
                    : null;

                subscription = {
                    isActive,
                    planName: planDoc?.name || null,
                    planId: planIdOut,
                    isTrial: Boolean(isTrial),
                    planDuration: PLAN_DURATIONS[duration] || null,
                };
            }
        } catch (err) {
            this.logger.error("Subscription lookup failed", {
                requestId: req.requestId,
                userId: String(userId),
                message: err.message,
            });
        }

        const assessments = [];

        try {
            const orders = await Order.find({
                userId,
                status: ORDER_STATUSES.SUCCEEDED,
                assessmentId: { $exists: true },
            })
                .select("assessmentId")
                .lean();

            const purchasedIds = orders.map((order) =>
                String(order.assessmentId),
            );

            const uniqueAssessmentIds = Array.from(new Set(purchasedIds));

            const submitted = await this.assessmentService.findScores({
                userId,
                type: ASSESSMENT_TYPES.FULL,
                assessmentId: { $in: uniqueAssessmentIds },
            });

            const submittedSet = new Set(
                submitted.map((score) => String(score.assessmentId)),
            );

            const unused = unusedPurchaseIds(purchasedIds, submittedSet);

            for (const assessmentId of uniqueAssessmentIds) {
                assessments.push({
                    assessmentId,
                    isSubmitted: !unused.has(assessmentId),
                });
            }
        } catch (err) {
            this.logger.error("Purchased assessment lookup failed", {
                requestId: req.requestId,
                userId: String(userId),
                message: err.message,
            });
        }

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.SUBSCRIPTION_AND_ASSESSMENTS,
            data: { subscription, assessments },
        });
    }

    async getAssessmentStatistics(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the assessment statistics", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const allCategories =
            await this.assessmentService.findActiveCategories();

        const categorySubcategories = {};

        for (const category of allCategories) {
            const assessments =
                await this.assessmentService.findActiveByCategory(
                    category,
                    "subcategories",
                );

            const subcats = new Set();

            assessments.forEach((assessment) => {
                if (Array.isArray(assessment.subcategories)) {
                    assessment.subcategories.forEach((sub) => subcats.add(sub));
                }
            });

            categorySubcategories[category] = Array.from(subcats);
        }

        const now = new Date();
        const today = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
        );

        const timePeriods = ASSESSMENT_STAT_PERIODS.map((period) => ({
            name: period.name,
            start: new Date(
                today.getTime() - period.days * 24 * 60 * 60 * 1000,
            ),
        }));

        const userScores = await this.assessmentService.findScores({
            userId,
            type: ASSESSMENT_TYPES.FULL,
        });

        const validScores = userScores.filter((score) => score.mainCategory);
        const statistics = {};

        for (const category of allCategories) {
            const subcategories = categorySubcategories[category] || [];
            const emptyTotals = () =>
                Object.fromEntries(subcategories.map((sub) => [sub, 0]));

            statistics[category] = {
                isDataPresent: false,
                ...Object.fromEntries(
                    timePeriods.map((period) => [period.name, emptyTotals()]),
                ),
            };

            const categoryScores = validScores.filter(
                (score) => score.mainCategory === category,
            );

            if (categoryScores.length === 0) {
                continue;
            }

            statistics[category].isDataPresent = true;

            for (const period of timePeriods) {
                const periodScores = categoryScores.filter(
                    (score) => new Date(score.date) >= period.start,
                );

                const subcategoryTotals = emptyTotals();

                periodScores.forEach((score) => {
                    const byCategory = this.assessmentService.toPlainObject(
                        score.byCategory,
                    );

                    Object.entries(byCategory).forEach(([sub, points]) => {
                        if (subcategories.includes(sub)) {
                            subcategoryTotals[sub] =
                                (subcategoryTotals[sub] || 0) + (points || 0);
                        }
                    });
                });

                statistics[category][period.name] = subcategoryTotals;
            }
        }

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.STATISTICS,
            data: { statistics },
        });
    }

    async resolvePriceInfo(assessment) {
        if (assessment.stripeProductId) {
            const base = {
                stripeProductId: assessment.stripeProductId,
                type: "one_time",
                active: true,
            };

            const priceInfo =
                (await PriceCatalog.findOne({ ...base, default: true })
                    .select("currency unitAmount")
                    .lean()) ||
                (await PriceCatalog.findOne(base)
                    .sort({ createdAt: -1 })
                    .select("currency unitAmount")
                    .lean());

            if (priceInfo) {
                return priceInfo;
            }
        }

        return await PriceCatalog.findOne({
            assessmentId: assessment._id,
            type: "one_time",
            active: true,
        })
            .select("currency unitAmount")
            .lean();
    }

    async getDailyRecommendedAssessment(req, res, next) {
        const userId = req.user._id;
        const today = getCETMidnight(new Date());

        this.logger.info("Request to read the daily recommended assessment", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const dailyAssignment = await DailyChallenge.findOne({
            date: today,
        }).lean();

        let targetAssessmentId = null;

        if (dailyAssignment) {
            const quickMini = await this.assessmentService.findQuickMiniById(
                dailyAssignment.quickAssessmentId,
                "fullAssessment",
            );

            if (quickMini?.fullAssessment) {
                targetAssessmentId = quickMini.fullAssessment;
            }
        }

        let assessmentToReturn = null;

        if (targetAssessmentId) {
            const hasPurchased = await Order.findOne({
                userId,
                assessmentId: targetAssessmentId,
                status: ORDER_STATUSES.SUCCEEDED,
            }).lean();

            if (!hasPurchased) {
                assessmentToReturn =
                    await this.assessmentService.findFullAssessmentById(
                        targetAssessmentId,
                        RECOMMENDATION_SELECT,
                    );
            }
        }

        if (!assessmentToReturn) {
            const purchasedOrders = await Order.find({
                userId,
                status: ORDER_STATUSES.SUCCEEDED,
            })
                .select("assessmentId")
                .lean();

            const purchasedAssessmentIds = purchasedOrders
                .map((order) => order.assessmentId?.toString())
                .filter(Boolean);

            const unpurchased =
                await this.assessmentService.findActiveExcluding(
                    purchasedAssessmentIds,
                    RECOMMENDATION_SELECT,
                );

            assessmentToReturn =
                pickRandomItem(unpurchased) ||
                pickRandomItem(
                    await this.assessmentService.findActiveExcluding(
                        [],
                        RECOMMENDATION_SELECT,
                    ),
                );
        }

        if (!assessmentToReturn) {
            return next(
                createHttpError(
                    404,
                    FULL_ASSESSMENT_MESSAGES.NO_ASSESSMENTS_AVAILABLE,
                ),
            );
        }

        const priceInfo = await this.resolvePriceInfo(assessmentToReturn);

        this.logger.info("Daily recommended assessment sent", {
            requestId: req.requestId,
            userId: String(userId),
            assessmentId: String(assessmentToReturn._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.DAILY_RECOMMENDED,
            data: {
                assessmentId: assessmentToReturn._id,
                questions: assessmentToReturn.questions,
                title: assessmentToReturn.title,
                description: assessmentToReturn.description,
                mainCategory: assessmentToReturn.mainCategory,
                isAvailReport: assessmentToReturn.isAvailReport,
                isAvailCertification: assessmentToReturn.isAvailCertification,
                price: {
                    currency:
                        priceInfo?.currency || ASSESSMENT_DEFAULTS.CURRENCY,
                    unitAmount: priceInfo?.unitAmount || 0,
                },
            },
        });
    }

    async getCurrentMiniAssessmentWithPurchaseStatus(req, res, next) {
        const userId = req.user._id;
        const today = getCETMidnight(new Date());

        this.logger.info("Request to read the current mini purchase status", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const dailyAssignment = await DailyChallenge.findOne({
            date: today,
        }).lean();

        if (!dailyAssignment) {
            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: FULL_ASSESSMENT_MESSAGES.NO_QUICK_TODAY,
                data: { assessment: null, isAlreadyPurchased: false },
            });
        }

        const quickMini = await this.assessmentService.findQuickMiniById(
            dailyAssignment.quickAssessmentId,
            "fullAssessment",
        );

        if (!quickMini?.fullAssessment) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.QUICK_NOT_FOUND),
            );
        }

        const fullAssessment =
            await this.assessmentService.findFullAssessmentById(
                quickMini.fullAssessment,
                "_id mainCategory title description questions subcategories isAvailReport isAvailCertification",
            );

        if (!fullAssessment) {
            return next(
                createHttpError(404, FULL_ASSESSMENT_MESSAGES.NOT_FOUND),
            );
        }

        const hasPurchased = await Order.findOne({
            userId,
            assessmentId: fullAssessment._id,
            status: ORDER_STATUSES.SUCCEEDED,
        }).lean();

        const priceInfo = await PriceCatalog.findOne({
            assessmentId: fullAssessment._id,
            default: true,
            active: true,
        })
            .select("currency unitAmount")
            .lean();

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.CURRENT_MINI_PURCHASE_STATUS,
            data: {
                assessmentId: fullAssessment._id,
                questions: fullAssessment.questions,
                title: fullAssessment.title,
                description: fullAssessment.description,
                mainCategory: fullAssessment.mainCategory,
                isAvailReport: fullAssessment.isAvailReport,
                isAvailCertification: fullAssessment.isAvailCertification,
                price: {
                    currency:
                        priceInfo?.currency || ASSESSMENT_DEFAULTS.CURRENCY,
                    unitAmount: priceInfo?.unitAmount || 0,
                },
                isAlreadyPurchased: Boolean(hasPurchased),
            },
        });
    }

    async getUserSubmittedFullAssessments(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the submitted full assessments", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const scores = await this.assessmentService.findScores(
            { userId, type: ASSESSMENT_TYPES.FULL },
            { sort: { createdAt: -1 } },
        );

        if (scores.length === 0) {
            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: FULL_ASSESSMENT_MESSAGES.NO_SUBMITTED_FULL,
                data: { assessments: [] },
            });
        }

        const assessmentIds = [
            ...new Set(scores.map((score) => score.assessmentId)),
        ];

        const assessments = await this.assessmentService.findFullAssessments(
            assessmentIds,
            "_id title isAvailReport isAvailCertification",
        );

        const assessmentMap = new Map(
            assessments.map((assessment) => [
                String(assessment._id),
                assessment,
            ]),
        );

        const submittedAssessments = [];
        const processed = new Set();

        for (const score of scores) {
            const assessmentId = String(score.assessmentId);

            if (processed.has(assessmentId)) {
                continue;
            }

            const assessment = assessmentMap.get(assessmentId);

            if (assessment) {
                submittedAssessments.push({
                    _id: assessment._id,
                    title: assessment.title,
                    submittedDate: score.createdAt,
                    isAvailReport: assessment.isAvailReport || false,
                    isAvailCertification:
                        assessment.isAvailCertification || false,
                });
                processed.add(assessmentId);
            }
        }

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.SUBMITTED_FULL,
            data: { assessments: submittedAssessments },
        });
    }

    async getUserFullAssessmentScores(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the full assessment scores", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const user = await User.findById(userId)
            .select("name age landingPageName quickMiniAssessmntId")
            .lean();

        const scores = await this.assessmentService.findScores(
            { userId, type: ASSESSMENT_TYPES.FULL },
            { sort: { createdAt: -1 } },
        );

        let specialScore = null;

        if (user?.landingPageName && user?.quickMiniAssessmntId) {
            const specialScores = await this.assessmentService.findScores(
                { userId, assessmentId: user.quickMiniAssessmntId },
                { sort: { createdAt: 1 }, limit: 1 },
            );

            specialScore = specialScores[0] || null;
        }

        if (scores.length === 0 && !specialScore) {
            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: FULL_ASSESSMENT_MESSAGES.NO_FULL_SCORES,
                data: { scores: [] },
            });
        }

        const assessmentIds = [
            ...new Set(scores.map((score) => score.assessmentId)),
        ];

        const assessments = await this.assessmentService.findFullAssessments(
            assessmentIds,
            "_id title mainCategory questions isAvailReport isAvailCertification",
        );

        const assessmentMap = new Map(
            assessments.map((assessment) => [
                String(assessment._id),
                assessment,
            ]),
        );

        const formattedScores = scores.map((score) => {
            const assessment = assessmentMap.get(String(score.assessmentId));

            return {
                _id: score._id,
                totalScore:
                    score.totalScore !== undefined ? score.totalScore : 0,
                byCategory: this.assessmentService.toPlainObject(
                    score.byCategory,
                ),
                date: score.createdAt,
                mainCategory: score.mainCategory,
                assessmentId: score.assessmentId,
                programScore:
                    score.programScore !== undefined
                        ? score.programScore
                        : null,
                userName: user?.name || ASSESSMENT_DEFAULTS.UNKNOWN_USER,
                assessmentName:
                    assessment?.title || ASSESSMENT_DEFAULTS.UNKNOWN_ASSESSMENT,
                userAge: user?.age || null,
                totalQuestions: assessment?.questions || 0,
                canGenerateCertificate:
                    assessment?.isAvailCertification || false,
                canGenerateReport: assessment?.isAvailReport || false,
                isSpecial: false,
            };
        });

        if (specialScore) {
            formattedScores.unshift(
                await this.formatSpecialScore(specialScore, user),
            );
        }

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.FULL_SCORES,
            data: { scores: formattedScores },
        });
    }

    async formatSpecialScore(specialScore, user) {
        let assessmentName = ASSESSMENT_DEFAULTS.UNKNOWN_ASSESSMENT;
        let totalQuestions = 0;
        let canGenerateCertificate = false;
        let canGenerateReport = false;

        const detailSelect =
            "_id title mainCategory questions isAvailReport isAvailCertification";

        if (specialScore.type === ASSESSMENT_TYPES.QUICK) {
            const quickMini = await this.assessmentService.findQuickMiniById(
                specialScore.assessmentId,
                "fullAssessment questions",
            );

            if (quickMini?.fullAssessment) {
                const fullAssessment =
                    await this.assessmentService.findFullAssessmentById(
                        quickMini.fullAssessment,
                        detailSelect,
                    );

                if (fullAssessment) {
                    assessmentName =
                        fullAssessment.title ||
                        ASSESSMENT_DEFAULTS.UNKNOWN_ASSESSMENT;
                    totalQuestions = quickMini.questions?.length || 0;
                    canGenerateCertificate =
                        fullAssessment.isAvailCertification || false;
                    canGenerateReport = fullAssessment.isAvailReport || false;
                }
            }
        } else {
            const fullAssessment =
                await this.assessmentService.findFullAssessmentById(
                    specialScore.assessmentId,
                    detailSelect,
                );

            if (fullAssessment) {
                assessmentName =
                    fullAssessment.title ||
                    ASSESSMENT_DEFAULTS.UNKNOWN_ASSESSMENT;
                totalQuestions = fullAssessment.questions || 0;
                canGenerateCertificate =
                    fullAssessment.isAvailCertification || false;
                canGenerateReport = fullAssessment.isAvailReport || false;
            }
        }

        return {
            _id: specialScore._id,
            totalScore:
                specialScore.totalScore !== undefined
                    ? specialScore.totalScore
                    : 0,
            byCategory: this.assessmentService.toPlainObject(
                specialScore.byCategory,
            ),
            date: specialScore.createdAt,
            mainCategory: specialScore.mainCategory,
            assessmentId: specialScore.assessmentId,
            programScore:
                specialScore.programScore !== undefined
                    ? specialScore.programScore
                    : null,
            userName: user?.name || ASSESSMENT_DEFAULTS.UNKNOWN_USER,
            assessmentName,
            userAge: user?.age || null,
            totalQuestions,
            canGenerateCertificate,
            canGenerateReport,
            isSpecial: true,
            type: specialScore.type,
        };
    }

    async getFullAssessments(req, res) {
        const userId = req.user?._id;

        this.logger.info("Request to list the full assessments", {
            requestId: req.requestId,
            userId: userId ? String(userId) : null,
        });

        const uniqueCategories =
            await this.assessmentService.findActiveCategories();

        const purchasedAssessments = userId
            ? await this.assessmentService.findPurchasedAssessments(userId)
            : [];

        const completedIds = await this.completedAssessmentIds(userId);

        const unusedPurchases = unusedPurchaseIds(
            purchasedAssessments.map((assessment) => String(assessment._id)),
            completedIds,
        );

        const selectedAssessments = [];

        for (const category of uniqueCategories) {
            const { assessment, isAssessmentPurchased } =
                await this.selectForCategory({
                    category,
                    userId,
                    purchasedAssessments,
                    completedIds,
                    unusedPurchases,
                });

            if (assessment) {
                const priceInfo = await this.resolvePriceInfo(assessment);

                selectedAssessments.push({
                    ...assessment,
                    isAssessmentPurchased,
                    price: {
                        currency:
                            priceInfo?.currency || ASSESSMENT_DEFAULTS.CURRENCY,
                        unitAmount: priceInfo?.unitAmount || 0,
                    },
                });
            }
        }

        const purchasedUnsubmittedAssessments = [
            ...new Map(
                purchasedAssessments
                    .filter((assessment) =>
                        unusedPurchases.has(String(assessment._id)),
                    )
                    .map((assessment) => [
                        String(assessment._id),
                        { ...assessment, isAssessmentPurchased: true },
                    ]),
            ).values(),
        ];

        this.logger.info("Full assessments sent", {
            requestId: req.requestId,
            userId: userId ? String(userId) : null,
            categories: uniqueCategories.length,
            selected: selectedAssessments.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: FULL_ASSESSMENT_MESSAGES.LISTED,
            data: {
                total: selectedAssessments.length,
                categories: uniqueCategories,
                items: selectedAssessments,
                purchasedUnsubmittedAssessments,
                adhdAssessment: await this.sideAssessment(
                    this.adhdAssessmentService,
                    userId,
                ),
                emotionalIntelligenceAssessment: await this.sideAssessment(
                    this.eiAssessmentService,
                    userId,
                ),
            },
        });
    }

    async sideAssessment(service, userId) {
        try {
            const picked = await service.pickForUser(userId);

            if (!picked.assessment) return null;

            const priceInfo = picked.assessment.priceCatalogId
                ? await PriceCatalog.findById(picked.assessment.priceCatalogId)
                      .select("currency unitAmount")
                      .lean()
                : null;

            return {
                ...picked.assessment,
                isAssessmentPurchased: picked.isAssessmentPurchased,
                price: {
                    currency:
                        priceInfo?.currency || ASSESSMENT_DEFAULTS.CURRENCY,
                    unitAmount: priceInfo?.unitAmount || 0,
                },
            };
        } catch (err) {
            this.logger.error("Side assessment resolution failed", {
                userId: userId ? String(userId) : null,
                message: err.message,
            });

            return null;
        }
    }

    async completedAssessmentIds(userId) {
        if (!userId) {
            return new Set();
        }

        const scores = await this.assessmentService.findScores({
            userId,
            type: ASSESSMENT_TYPES.FULL,
        });

        return new Set(scores.map((score) => String(score.assessmentId)));
    }

    async selectForCategory({
        category,
        userId,
        purchasedAssessments,
        completedIds,
        unusedPurchases,
    }) {
        const candidates =
            await this.assessmentService.findActiveByCategory(category);

        if (!userId) {
            return {
                assessment: pickRandomItem(candidates),
                isAssessmentPurchased: false,
            };
        }

        const unsubmittedPurchase = purchasedAssessments.find(
            (assessment) =>
                assessment.mainCategory === category &&
                unusedPurchases.has(String(assessment._id)),
        );

        if (unsubmittedPurchase) {
            return {
                assessment: unsubmittedPurchase,
                isAssessmentPurchased: true,
            };
        }

        const fromChallenge = await this.assessmentFromTodaysChallenge({
            category,
            completedIds,
        });

        if (fromChallenge) {
            return {
                assessment: fromChallenge,
                isAssessmentPurchased: false,
            };
        }

        // Offer one the user has not taken yet. Repeating is only acceptable
        // once the category is exhausted, otherwise they get sold a rerun
        // while unseen assessments are still pending.
        const unseen = candidates.filter(
            (assessment) => !completedIds.has(String(assessment._id)),
        );

        return {
            assessment: pickRandomItem(unseen.length ? unseen : candidates),
            isAssessmentPurchased: false,
        };
    }

    async assessmentFromTodaysChallenge({ category, completedIds }) {
        const now = new Date();
        const startOfDay = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
        );
        const endOfDay = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
        );

        const todaysAssignments = await DailyChallenge.find({
            createdAt: { $gte: startOfDay, $lt: endOfDay },
        })
            .populate({
                path: "quickAssessmentId",
                populate: {
                    path: "fullAssessment",
                    match: { mainCategory: category, active: true },
                },
            })
            .lean();

        for (const assignment of todaysAssignments) {
            const fullAssessment = assignment.quickAssessmentId?.fullAssessment;

            if (fullAssessment?.mainCategory !== category) {
                continue;
            }

            if (!completedIds.has(String(fullAssessment._id))) {
                return fullAssessment;
            }
        }

        return null;
    }
}

module.exports = { AssessmentController };
