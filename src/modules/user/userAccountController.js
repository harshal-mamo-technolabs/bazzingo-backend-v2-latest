const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    USER_MESSAGES,
    ACCOUNT_DELETION,
    DATA_EXPORT,
    KLAVIYO_EVENTS,
    KLAVIYO_PROFILE_PROPERTIES,
} = require("../../constants");

class UserAccountController {
    constructor(userDataService, klaviyoService, stripeClient, logger) {
        this.userDataService = userDataService;
        this.klaviyoService = klaviyoService;
        this.stripeClient = stripeClient;
        this.logger = logger;
    }

    async exportUserData(req, res, next) {
        const userId = req.user._id;

        this.logger.info("Request to export the personal data", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const account = await this.userDataService.findAccount(userId);

        if (!account) {
            return next(createHttpError(404, USER_MESSAGES.NOT_FOUND));
        }

        const collected =
            await this.userDataService.collectPersonalData(userId);

        const summary = {
            assessments:
                collected.generalAssessments.length +
                collected.adhdAssessments.length +
                collected.emotionalIntelligenceAssessments.length,
            gameRecords:
                collected.gameScores.length + collected.gamePlays.length,
            activityRecords:
                collected.dailyActivity.length +
                collected.quickAssignments.length,
            badges: collected.badgeUnlocks.length,
            billingRecords:
                collected.orders.length + collected.legacySubscriptions.length,
            notifications: collected.notifications.length,
        };

        this.logger.info("Personal data export ready", {
            requestId: req.requestId,
            userId: String(userId),
            ...summary,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: DATA_EXPORT.READY,
            data: {
                export: {
                    exportVersion: DATA_EXPORT.VERSION,
                    generatedAt: new Date().toISOString(),
                    subject: {
                        userId: String(account._id),
                        name: account.name,
                        email: account.email,
                    },
                    summary,
                    data: {
                        account,
                        assessments: {
                            general: collected.generalAssessments,
                            adhd: collected.adhdAssessments,
                            emotionalIntelligence:
                                collected.emotionalIntelligenceAssessments,
                        },
                        games: {
                            scores: collected.gameScores,
                            plays: collected.gamePlays,
                            dailySuggestions: collected.dailyGameSuggestions,
                        },
                        activity: {
                            dailyActivity: collected.dailyActivity,
                            quickAssignments: collected.quickAssignments,
                        },
                        achievements: {
                            badgeUnlocks: collected.badgeUnlocks,
                        },
                        billing: {
                            orders: collected.orders,
                            payments: [],
                            subscriptions: [],
                            legacySubscriptions: collected.legacySubscriptions,
                        },
                        notifications: collected.notifications,
                        leaderboard: collected.leaderboard,
                    },
                },
            },
        });
    }

    async deleteAccount(req, res, next) {
        const userId = req.user._id;

        this.logger.info("Request to delete an account", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const user = await this.userDataService.findAccount(userId);

        if (!user) {
            return next(createHttpError(404, USER_MESSAGES.NOT_FOUND));
        }

        if (user.isDeleted) {
            return next(
                createHttpError(409, ACCOUNT_DELETION.ALREADY_DELETED, {
                    context: {
                        reason: ACCOUNT_DELETION.ALREADY_DELETED_REASON,
                    },
                }),
            );
        }

        const blocking = await this.userDataService.findBlockingSubscription(
            userId,
            ACCOUNT_DELETION.BLOCKING_STATUSES,
        );

        if (blocking) {
            this.logger.warn("Account deletion blocked by a subscription", {
                requestId: req.requestId,
                userId: String(userId),
            });

            return next(
                createHttpError(409, ACCOUNT_DELETION.ACTIVE_SUBSCRIPTION, {
                    context: {
                        reason: ACCOUNT_DELETION.ACTIVE_SUBSCRIPTION_REASON,
                    },
                }),
            );
        }

        const reason =
            typeof req.body?.reason === "string" && req.body.reason.trim()
                ? req.body.reason.trim()
                : null;

        const wouldHaveStayedIfOffered = Array.isArray(
            req.body?.wouldHaveStayedIfOffered,
        )
            ? req.body.wouldHaveStayedIfOffered.filter(
                  (item) => typeof item === "string",
              )
            : [];

        const subscriptionStatusAtDeletion =
            await this.userDataService.findLatestSubscriptionStatus(userId);

        const deletedAt = new Date();

        await this.userDataService.recordDeletionFeedback({
            userId,
            email: user.email,
            name: user.name,
            reason,
            wouldHaveStayedIfOffered,
            subscriptionStatusAtDeletion,
            source: ACCOUNT_DELETION.SOURCE,
            deletedAt,
        });

        await this.syncKlaviyoDeletion({
            req,
            user,
            userId,
            reason,
            wouldHaveStayedIfOffered,
            subscriptionStatusAtDeletion,
            deletedAt,
        });

        await this.flagStripeCustomer({ req, user, reason, deletedAt });

        await this.userDataService.silenceAccount(userId);
        await this.userDataService.markDeleted({ userId, deletedAt, reason });

        this.logger.info("Account deleted", {
            requestId: req.requestId,
            userId: String(userId),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: ACCOUNT_DELETION.DELETED,
        });
    }

    async syncKlaviyoDeletion({
        req,
        user,
        userId,
        reason,
        wouldHaveStayedIfOffered,
        subscriptionStatusAtDeletion,
        deletedAt,
    }) {
        if (!user.email) {
            return;
        }

        try {
            await this.klaviyoService.upsertProfileByEmail({
                email: user.email,
                name: user.name,
                properties: {
                    [KLAVIYO_PROFILE_PROPERTIES.ACCOUNT_DELETED]: true,
                    [KLAVIYO_PROFILE_PROPERTIES.ACCOUNT_DELETION_REASON]:
                        reason || ACCOUNT_DELETION.NOT_PROVIDED,
                    [KLAVIYO_PROFILE_PROPERTIES.WOULD_HAVE_STAYED_IF_OFFERED]:
                        wouldHaveStayedIfOffered,
                    [KLAVIYO_PROFILE_PROPERTIES.ACCOUNT_DELETED_AT]:
                        deletedAt.toISOString(),
                },
            });

            await this.klaviyoService.createEvent({
                email: user.email,
                metricName: KLAVIYO_EVENTS.ACCOUNT_DELETED,
                uniqueId: `${userId}:AccountDeleted`,
                timeISO: deletedAt.toISOString(),
                properties: {
                    "deletion reason": reason || ACCOUNT_DELETION.NOT_PROVIDED,
                    "would have stayed if offered": wouldHaveStayedIfOffered,
                    "subscription status at deletion":
                        subscriptionStatusAtDeletion ||
                        ACCOUNT_DELETION.NO_SUBSCRIPTION,
                },
            });

            this.logger.info("Klaviyo account deletion synced", {
                requestId: req.requestId,
                userId: String(userId),
            });
        } catch (err) {
            this.logger.error("Klaviyo account deletion sync failed", {
                requestId: req.requestId,
                userId: String(userId),
                message: err.message,
            });
        }
    }

    async flagStripeCustomer({ req, user, reason, deletedAt }) {
        if (!user.stripeCustomerId || !this.stripeClient) {
            return;
        }

        try {
            await this.stripeClient.customers.update(user.stripeCustomerId, {
                metadata: {
                    bazingo_account_deleted: "true",
                    bazingo_account_deleted_at: deletedAt.toISOString(),
                    bazingo_account_deletion_reason:
                        reason || ACCOUNT_DELETION.NOT_PROVIDED,
                },
            });

            this.logger.info("Stripe customer flagged as deleted", {
                requestId: req.requestId,
                stripeCustomerId: user.stripeCustomerId,
            });
        } catch (err) {
            this.logger.error("Stripe customer flagging failed", {
                requestId: req.requestId,
                stripeCustomerId: user.stripeCustomerId,
                message: err.message,
            });
        }
    }
}

module.exports = { UserAccountController };
