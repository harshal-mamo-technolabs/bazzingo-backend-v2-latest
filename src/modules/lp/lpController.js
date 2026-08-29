const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");
const { config } = require("../../config");
const { sendResponse } = require("../../common/utils/response");
const { getCETMidnight } = require("../../common/utils/time");
const {
    applyUtmToRecord,
    parseUtmParams,
} = require("../../common/utils/utmParams");
const {
    ACCOUNT_DELETED_REASON,
    ASSESSMENT_DEFAULTS,
    ASSESSMENT_TYPES,
    AUTH_MESSAGES,
    KLAVIYO_EVENTS,
    LP_FUNNEL_STAGES,
    LP_HOOK_SNAPSHOT_FIELDS,
    LP_HOOK_UPDATABLE_FIELDS,
    LP_KLAVIYO_EVENT_IDS,
    LP_KLAVIYO_PROPERTIES,
    LP_MESSAGES,
    LP_RESUME_TOKEN_EXPIRY,
    LP_SELECT,
    LP_SYNC_SOURCES,
    LP_UTM_MEDIUM_QUERY_PARAM,
    RESPONSE_STATUS,
} = require("../../constants");
const { getAssessmentAgeGroup } = require("../assessment/assessmentService");

class LpController {
    constructor(
        lpService,
        assessmentService,
        klaviyoSyncService,
        klaviyoService,
        leaderboardService,
        badgeService,
        helpscoutService,
        logger,
    ) {
        this.lpService = lpService;
        this.assessmentService = assessmentService;
        this.klaviyoSyncService = klaviyoSyncService;
        this.klaviyoService = klaviyoService;
        this.leaderboardService = leaderboardService;
        this.badgeService = badgeService;
        this.helpscoutService = helpscoutService;
        this.logger = logger;
    }

    async syncHookSideEffects(req, { hook, previousHook, source }) {
        if (!hook?.email) {
            return;
        }

        try {
            await this.klaviyoSyncService.syncLandingPageHook({
                hook,
                previousHook,
                source,
            });
        } catch (err) {
            this.logger.error("Landing page hook Klaviyo sync failed", {
                requestId: req.requestId,
                uuid: hook.uuid,
                source,
                message: err.message,
                stack: err.stack,
            });
        }

        await this.lpService.backfillUserUtmFromHook(hook);

        this.helpscoutService.scheduleSyncContactUtmToHelpScout({
            email: hook.email,
            name: hook.name,
            utmSource: hook.utmSource,
            utmCampaign: hook.utmCampaign,
            utmMedium: hook.utmMedium,
            utmEmail: hook.utmEmail,
        });
    }

    async createLpHook(req, res, next) {
        const { uuid } = req.body;

        this.logger.info("Request to create a landing page hook", {
            requestId: req.requestId,
            uuid,
        });

        if (!uuid) {
            return next(createHttpError(400, LP_MESSAGES.UUID_REQUIRED));
        }

        let hook = await this.lpService.findHookByUuid(uuid);

        if (hook) {
            for (const key of LP_HOOK_UPDATABLE_FIELDS) {
                if (req.body[key] !== undefined && req.body[key] !== null) {
                    hook[key] = req.body[key];
                }
            }

            applyUtmToRecord(
                hook,
                parseUtmParams(req.body, { onlyProvided: true }),
            );
            await this.lpService.saveHook(hook);
        } else {
            const fields = { uuid };

            for (const key of LP_HOOK_UPDATABLE_FIELDS) {
                if (req.body[key] !== undefined) {
                    fields[key] = req.body[key];
                }
            }

            hook = await this.lpService.createHook({
                ...fields,
                ...parseUtmParams(req.body),
            });
        }

        await this.syncHookSideEffects(req, {
            hook,
            previousHook: null,
            source: LP_SYNC_SOURCES.HOOK_CREATE,
        });

        this.logger.info("Landing page hook created", {
            requestId: req.requestId,
            uuid,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: LP_MESSAGES.HOOK_CREATED,
            data: { hook },
        });
    }

    async updateLpHook(req, res, next) {
        const { uuid } = req.params;
        const updates = req.body;

        this.logger.info("Request to update a landing page hook", {
            requestId: req.requestId,
            uuid,
        });

        if (!uuid) {
            return next(createHttpError(400, LP_MESSAGES.UUID_REQUIRED));
        }

        const hook = await this.lpService.findHookByUuid(uuid);

        if (!hook) {
            return next(createHttpError(404, LP_MESSAGES.HOOK_NOT_FOUND));
        }

        const previousHook = Object.fromEntries(
            LP_HOOK_SNAPSHOT_FIELDS.map((field) => [field, hook[field]]),
        );

        applyUtmToRecord(hook, parseUtmParams(updates, { onlyProvided: true }));

        for (const key of Object.keys(updates)) {
            if (LP_HOOK_UPDATABLE_FIELDS.includes(key)) {
                hook[key] = updates[key];
            }
        }

        await this.lpService.saveHook(hook);

        await this.syncHookSideEffects(req, {
            hook,
            previousHook,
            source: LP_SYNC_SOURCES.HOOK_UPDATE,
        });

        this.logger.info("Landing page hook updated", {
            requestId: req.requestId,
            uuid,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: LP_MESSAGES.HOOK_UPDATED,
            data: { hook },
        });
    }

    async resumeLpHook(req, res, next) {
        const { uuid } = req.params;

        this.logger.info("Request to resume a landing page hook", {
            requestId: req.requestId,
            uuid,
        });

        if (!uuid) {
            return next(createHttpError(400, LP_MESSAGES.UUID_REQUIRED));
        }

        const hook = await this.lpService.findHookByUuid(uuid);

        if (!hook) {
            return next(createHttpError(404, LP_MESSAGES.HOOK_NOT_FOUND));
        }

        const queryUtmEmail = req.query[LP_UTM_MEDIUM_QUERY_PARAM];
        const utmEmail =
            typeof queryUtmEmail === "string" ? queryUtmEmail.trim() : "";
        const previousHook = hook.toObject();

        if (utmEmail && hook.utmEmail !== utmEmail) {
            hook.utmEmail = utmEmail;
            await this.lpService.saveHook(hook);
        }

        const stage = this.klaviyoSyncService.funnelStage(hook);
        const token = await this.mintResumeToken(req, hook, stage);

        if (hook.email) {
            try {
                await this.klaviyoSyncService.syncLandingPageHook({
                    hook,
                    previousHook,
                    source: LP_SYNC_SOURCES.HOOK_RESUME,
                });
            } catch (err) {
                this.logger.error("Landing page hook Klaviyo sync failed", {
                    requestId: req.requestId,
                    uuid,
                    source: LP_SYNC_SOURCES.HOOK_RESUME,
                    message: err.message,
                    stack: err.stack,
                });
            }

            if (utmEmail) {
                this.klaviyoService
                    .createEvent({
                        email: hook.email,
                        metricName:
                            KLAVIYO_EVENTS.LANDING_PAGE_RESUMED_FROM_EMAIL,
                        uniqueId: `${uuid}:${LP_KLAVIYO_EVENT_IDS.RESUMED}:${stage}`,
                        properties: {
                            [LP_KLAVIYO_PROPERTIES.STAGE]: stage,
                            [LP_KLAVIYO_PROPERTIES.MEDIUM]: utmEmail,
                            [LP_KLAVIYO_PROPERTIES.LANDING_PAGE_NAME]:
                                hook.landingPageName ?? undefined,
                        },
                    })
                    .catch((err) =>
                        this.logger.error(
                            "Failed to create the resume Klaviyo event",
                            {
                                requestId: req.requestId,
                                uuid,
                                message: err.message,
                            },
                        ),
                    );
            }
        }

        this.logger.info("Landing page hook resumed", {
            requestId: req.requestId,
            uuid,
            stage,
            hasToken: Boolean(token),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: LP_MESSAGES.HOOK_RESUMED,
            data: {
                stage,
                token,
                email: hook.email,
                name: hook.name,
                age: hook.age,
                country: hook.country,
                assessmentId: hook.assessmentId
                    ? String(hook.assessmentId)
                    : null,
                answers: hook.answers || [],
            },
        });
    }

    async mintResumeToken(req, hook, stage) {
        if (stage !== LP_FUNNEL_STAGES.CHECKOUT || !hook.email) {
            return null;
        }

        const user = await this.lpService.findUserByEmail(hook.email);

        if (!user || user.isDeleted) {
            this.logger.warn("Resume token skipped, no live user", {
                requestId: req.requestId,
                uuid: hook.uuid,
            });

            return null;
        }

        return jwt.sign({ userId: String(user._id) }, config.JWT_SECRET, {
            expiresIn: LP_RESUME_TOKEN_EXPIRY,
        });
    }

    async getQuickAssessmentById(req, res, next) {
        const { assessmentId } = req.params;

        this.logger.info("Request to read a landing page quick assessment", {
            requestId: req.requestId,
            assessmentId,
        });

        if (!assessmentId) {
            return next(
                createHttpError(400, LP_MESSAGES.QUICK_ASSESSMENT_ID_REQUIRED),
            );
        }

        const mini = await this.assessmentService.findQuickMiniById(
            assessmentId,
            LP_SELECT.QUICK_MINI,
        );

        if (!mini) {
            return next(
                createHttpError(404, LP_MESSAGES.QUICK_ASSESSMENT_NOT_FOUND),
            );
        }

        if (!mini.isActive) {
            return next(
                createHttpError(404, LP_MESSAGES.QUICK_ASSESSMENT_NOT_ACTIVE),
            );
        }

        const fullAssessment =
            await this.assessmentService.findFullAssessmentById(
                mini.fullAssessment,
                LP_SELECT.FULL_ASSESSMENT,
            );

        if (!fullAssessment) {
            return next(
                createHttpError(404, LP_MESSAGES.FULL_ASSESSMENT_NOT_FOUND),
            );
        }

        if (!fullAssessment.active) {
            return next(
                createHttpError(404, LP_MESSAGES.FULL_ASSESSMENT_NOT_ACTIVE),
            );
        }

        const questionDocs = await this.assessmentService.findQuestionsByIds(
            mini.questions,
            LP_SELECT.QUESTION_DETAIL,
        );

        const byId = new Map(
            questionDocs.map((question) => [String(question._id), question]),
        );
        const questions = mini.questions
            .map((id) => byId.get(String(id)))
            .filter(Boolean);

        this.logger.info("Landing page quick assessment read", {
            requestId: req.requestId,
            assessmentId,
            questions: questions.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: LP_MESSAGES.QUICK_ASSESSMENT_FETCHED,
            data: {
                assessment: {
                    ...mini,
                    title: fullAssessment.title,
                    description: fullAssessment.description,
                    mainCategory: fullAssessment.mainCategory,
                },
                questions,
            },
        });
    }

    async resolveMainCategory(req, mini) {
        try {
            const full = await this.assessmentService.findFullAssessmentById(
                mini.fullAssessment,
                LP_SELECT.MAIN_CATEGORY,
            );

            return full?.mainCategory || ASSESSMENT_DEFAULTS.MAIN_CATEGORY;
        } catch (err) {
            this.logger.error("Failed to resolve the main category", {
                requestId: req.requestId,
                message: err.message,
            });

            return ASSESSMENT_DEFAULTS.MAIN_CATEGORY;
        }
    }

    async applyProgramScore(
        req,
        { user, scoreDoc, mainCategory, total, date },
    ) {
        try {
            const ageGroup = getAssessmentAgeGroup(user.age);
            const ageGroupScores = await this.lpService.findAgeGroupScores(
                ageGroup,
                mainCategory,
            );
            const programScore = this.lpService.calculateProgramScore(
                total,
                ageGroupScores,
            );

            await this.assessmentService.setProgramScoreOnScore(
                scoreDoc._id,
                programScore,
            );
            await this.assessmentService.updateUserProgramScore(
                user._id,
                mainCategory,
                programScore,
                total,
            );
            await this.assessmentService.pushLegacyScore({
                userId: user._id,
                mainCategory,
                programScore,
                total,
                date,
                ageGroup,
            });

            this.logger.info("Landing page program score applied", {
                requestId: req.requestId,
                userId: String(user._id),
                mainCategory,
                programScore,
            });
        } catch (err) {
            this.logger.error("Landing page program score failed", {
                requestId: req.requestId,
                userId: String(user._id),
                mainCategory,
                message: err.message,
                stack: err.stack,
            });
        }
    }

    async submitQuickAssessmentScoreLp(req, res, next) {
        const { token, assessmentId, answers } = req.body;

        this.logger.info("Request to submit a landing page quick score", {
            requestId: req.requestId,
            assessmentId,
        });

        if (!token) {
            return next(createHttpError(400, LP_MESSAGES.TOKEN_REQUIRED));
        }

        if (!assessmentId || !Array.isArray(answers)) {
            return next(createHttpError(400, LP_MESSAGES.SUBMIT_REQUIRED));
        }

        let decoded;

        try {
            decoded = jwt.verify(token, config.JWT_SECRET);
        } catch (err) {
            this.logger.warn("Landing page score token rejected", {
                requestId: req.requestId,
                message: err.message,
            });

            return next(createHttpError(401, LP_MESSAGES.INVALID_TOKEN));
        }

        const user = await this.lpService.findUserById(decoded.userId);

        if (!user) {
            return next(createHttpError(404, LP_MESSAGES.USER_NOT_FOUND));
        }

        if (user.isDeleted) {
            return next(
                createHttpError(403, AUTH_MESSAGES.ACCOUNT_DELETED, {
                    context: { reason: ACCOUNT_DELETED_REASON },
                }),
            );
        }

        const mini =
            await this.assessmentService.findQuickMiniById(assessmentId);

        if (!mini) {
            return next(createHttpError(404, LP_MESSAGES.QUICK_MINI_NOT_FOUND));
        }

        if (!mini.isActive) {
            return next(
                createHttpError(400, LP_MESSAGES.QUICK_ASSESSMENT_NOT_ACTIVE),
            );
        }

        const questionDocs = await this.assessmentService.findQuestionsByIds(
            mini.questions,
            LP_SELECT.QUESTION_SCORING,
        );

        if (questionDocs.length === 0) {
            return next(createHttpError(404, LP_MESSAGES.QUESTIONS_NOT_FOUND));
        }

        const { total, byCategory, outOfScore } =
            this.assessmentService.scoreAnswers({ questionDocs, answers });
        const mainCategory = await this.resolveMainCategory(req, mini);
        const today = getCETMidnight(new Date());

        const scoreDoc = await this.assessmentService.saveScore({
            userId: user._id,
            type: ASSESSMENT_TYPES.QUICK,
            assessmentId,
            mainCategory,
            date: today,
            totalScore: total,
            byCategory,
        });

        await this.applyProgramScore(req, {
            user,
            scoreDoc,
            mainCategory,
            total,
            date: today,
        });

        await this.leaderboardService.syncProfile({
            userId: user._id,
            age: user.age,
            country: user.country,
            avatar: user.avatar,
            name: user.name,
        });

        try {
            await this.badgeService.unlockLeaderboardRookieBadge(user._id);
            await this.badgeService.unlockEarlyAdopterBadge(user._id);
        } catch (err) {
            this.logger.error("Landing page registration badges failed", {
                requestId: req.requestId,
                userId: String(user._id),
                message: err.message,
            });
        }

        try {
            await this.leaderboardService.addAssessmentScore({
                userId: user._id,
                category: mainCategory,
                score: total,
            });
        } catch (err) {
            this.logger.error("Landing page leaderboard score failed", {
                requestId: req.requestId,
                userId: String(user._id),
                message: err.message,
            });
        }

        await this.lpService.markAssessmentSubmitted(user);

        const updatedScoreDoc = await this.assessmentService.findScoreById(
            scoreDoc._id,
        );

        this.logger.info("Landing page quick score submitted", {
            requestId: req.requestId,
            userId: String(user._id),
            assessmentId,
            total,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: LP_MESSAGES.SCORE_SUBMITTED,
            data: {
                score: updatedScoreDoc,
                outOfScore,
                percentage:
                    outOfScore > 0 ? Math.round((total / outOfScore) * 100) : 0,
            },
        });
    }
}

module.exports = { LpController };
