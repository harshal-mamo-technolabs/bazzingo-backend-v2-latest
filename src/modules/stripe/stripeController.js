const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    STRIPE_RESPONSE_STATUSES,
    STRIPE_SUBSCRIPTION_TYPE_VALUES,
    STRIPE_SUBSCRIPTION_STATUSES,
    STRIPE_MESSAGES,
} = require("../../constants");

class StripeController {
    constructor(stripeService, logger) {
        this.stripeService = stripeService;
        this.logger = logger;
    }

    async createPrice(req, res, next) {
        const {
            assessmentId,
            planId,
            unitAmount,
            currency,
            productDuration,
            intervalCount,
            metadata,
            lookupKey,
        } = req.body;

        this.logger.info("Request to create a stripe price", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            assessmentId,
            planId,
        });

        if ((assessmentId && planId) || (!assessmentId && !planId)) {
            this.logger.warn("Stripe price creation failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_MESSAGES.PROVIDE_ASSESSMENT_OR_PLAN,
                ),
            );
        }

        if (typeof unitAmount !== "number" || unitAmount < 0) {
            this.logger.warn("Stripe price creation got a bad unit amount", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(
                createHttpError(400, STRIPE_MESSAGES.UNIT_AMOUNT_INVALID),
            );
        }

        try {
            const { price, stripePriceId } =
                await this.stripeService.createPrice({
                    assessmentId,
                    planId,
                    unitAmount,
                    ...(currency === undefined ? {} : { currency }),
                    productDuration,
                    ...(intervalCount === undefined ? {} : { intervalCount }),
                    ...(metadata === undefined ? {} : { metadata }),
                    lookupKey,
                });

            this.logger.info("Stripe price created", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
                stripePriceId,
            });

            return sendResponse(res, {
                statusCode: 201,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_MESSAGES.PRICE_CREATED,
                data: { price, stripePriceId },
            });
        } catch (error) {
            this.logger.error("Stripe price creation failed", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    async createCheckoutOrOneClick(req, res, next) {
        const { assessmentId, successUrl, cancelUrl } = req.body;

        this.logger.info("Request to create an assessment checkout", {
            requestId: req.requestId,
            userId: String(req.user._id),
            assessmentId,
        });

        if (!assessmentId) {
            return next(
                createHttpError(400, STRIPE_MESSAGES.ASSESSMENT_ID_REQUIRED),
            );
        }

        if (!successUrl || !cancelUrl) {
            return next(createHttpError(400, STRIPE_MESSAGES.URLS_REQUIRED));
        }

        try {
            const result = await this.stripeService.createCheckoutOrOneClick({
                user: req.user,
                assessmentId,
                successUrl,
                cancelUrl,
            });

            this.logger.info("Assessment checkout resolved", {
                requestId: req.requestId,
                userId: String(req.user._id),
                kind: result.kind,
            });

            if (result.kind === "one_click") {
                return sendResponse(res, {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message: STRIPE_MESSAGES.PAYMENT_INITIATED_WITH_SAVED_CARD,
                    data: {
                        orderId: result.order._id,
                        paymentIntentId: result.paymentIntent.id,
                        clientSecret: result.paymentIntent.client_secret,
                        status: result.order.status,
                    },
                });
            }

            if (result.kind === "requires_action") {
                return sendResponse(res, {
                    statusCode: 200,
                    status: STRIPE_RESPONSE_STATUSES.REQUIRES_ACTION,
                    message: STRIPE_MESSAGES.THREE_D_SECURE_REQUIRED,
                    data: {
                        requiresAction: true,
                        clientSecret: result.paymentIntent.client_secret,
                        paymentMethodId: result.paymentMethodId,
                        orderId: result.order._id,
                    },
                });
            }

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_MESSAGES.CHECKOUT_SESSION_CREATED,
                data: {
                    sessionId: result.session.id,
                    url: result.session.url,
                    orderId: result.order._id,
                },
            });
        } catch (error) {
            this.logger.error("Assessment checkout failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    async createSubscription(req, res, next) {
        const { planId, type, successUrl, cancelUrl } = req.body;

        this.logger.info("Request to create a subscription", {
            requestId: req.requestId,
            userId: String(req.user._id),
            planId,
            type,
        });

        if (!planId) {
            return next(createHttpError(400, STRIPE_MESSAGES.PLAN_ID_REQUIRED));
        }

        if (!type) {
            return next(createHttpError(400, STRIPE_MESSAGES.TYPE_REQUIRED));
        }

        if (!successUrl || !cancelUrl) {
            return next(createHttpError(400, STRIPE_MESSAGES.URLS_REQUIRED));
        }

        if (!STRIPE_SUBSCRIPTION_TYPE_VALUES.includes(type)) {
            return next(createHttpError(400, STRIPE_MESSAGES.TYPE_INVALID));
        }

        try {
            const result = await this.stripeService.createSubscription({
                user: req.user,
                planId,
                type,
                successUrl,
                cancelUrl,
            });

            this.logger.info("Subscription request resolved", {
                requestId: req.requestId,
                userId: String(req.user._id),
                kind: result.kind,
            });

            if (result.kind === "requires_action") {
                return sendResponse(res, {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message:
                        STRIPE_MESSAGES.SUBSCRIPTION_THREE_D_SECURE_REQUIRED,
                    data: {
                        subscriptionId: null,
                        status: STRIPE_SUBSCRIPTION_STATUSES.INCOMPLETE,
                        clientSecret: result.paymentIntent.client_secret,
                        paymentMethodId: result.paymentMethodId,
                        requiresAction: true,
                        paymentIntentId: result.paymentIntent.id,
                        plan: result.planInfo,
                    },
                });
            }

            if (result.kind === "created") {
                return sendResponse(res, {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message: this.savedCardMessage(result.planInfo),
                    data: {
                        subscriptionId: result.stripeSubscription.id,
                        status: result.stripeSubscription.status,
                        paymentIntentId: result.paymentIntent.id,
                        plan: result.planInfo,
                        paymentMethod: {
                            id: result.paymentMethodId,
                            saved: true,
                        },
                    },
                });
            }

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: this.checkoutMessage(result.planInfo),
                data: {
                    sessionId: result.session.id,
                    url: result.session.url,
                    plan: result.planInfo,
                },
            });
        } catch (error) {
            this.logger.error("Subscription creation failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    savedCardMessage({ trialHonored, trialRequested }) {
        if (trialHonored) {
            return STRIPE_MESSAGES.PAID_TRIAL_SUBSCRIPTION_WITH_SAVED_CARD;
        }

        return trialRequested
            ? STRIPE_MESSAGES.TRIAL_FALLBACK_SUBSCRIPTION_WITH_SAVED_CARD
            : STRIPE_MESSAGES.SUBSCRIPTION_WITH_SAVED_CARD;
    }

    checkoutMessage({ trialHonored, trialRequested }) {
        if (trialHonored) {
            return STRIPE_MESSAGES.PAID_TRIAL_CHECKOUT_SESSION_CREATED;
        }

        return trialRequested
            ? STRIPE_MESSAGES.TRIAL_FALLBACK_CHECKOUT_SESSION_CREATED
            : STRIPE_MESSAGES.SUBSCRIPTION_CHECKOUT_SESSION_CREATED;
    }

    async confirmSubscription(req, res, next) {
        const { paymentIntentId, planId, type } = req.body;

        this.logger.info("Request to confirm a subscription", {
            requestId: req.requestId,
            userId: String(req.user._id),
            planId,
            type,
        });

        if (!paymentIntentId) {
            return next(
                createHttpError(
                    400,
                    STRIPE_MESSAGES.PAYMENT_INTENT_ID_REQUIRED,
                ),
            );
        }

        if (!planId) {
            return next(createHttpError(400, STRIPE_MESSAGES.PLAN_ID_REQUIRED));
        }

        if (!type) {
            return next(createHttpError(400, STRIPE_MESSAGES.TYPE_REQUIRED));
        }

        try {
            const result = await this.stripeService.confirmSubscription({
                user: req.user,
                paymentIntentId,
                planId,
                type,
            });

            this.logger.info("Subscription confirmation resolved", {
                requestId: req.requestId,
                userId: String(req.user._id),
                kind: result.kind,
            });

            if (result.kind !== "created") {
                return sendResponse(res, {
                    statusCode: 400,
                    status: RESPONSE_STATUS.ERROR,
                    message:
                        result.kind === "requires_action"
                            ? STRIPE_MESSAGES.PAYMENT_INTENT_REQUIRES_ACTION
                            : STRIPE_MESSAGES.PAYMENT_INTENT_NOT_SUCCEEDED,
                    data: {
                        paymentIntentId: result.paymentIntent.id,
                        status: result.paymentIntent.status,
                    },
                });
            }

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: result.planInfo.trialHonored
                    ? STRIPE_MESSAGES.SUBSCRIPTION_WITH_TRIAL_AFTER_3DS
                    : STRIPE_MESSAGES.SUBSCRIPTION_AFTER_3DS,
                data: {
                    subscriptionId: result.stripeSubscription.id,
                    status: result.stripeSubscription.status,
                    paymentIntentId: result.paymentIntent.id,
                    plan: result.planInfo,
                },
            });
        } catch (error) {
            this.logger.error("Subscription confirmation failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    async getSubscriptionStatus(req, res, next) {
        this.logger.info("Request for the subscription status", {
            requestId: req.requestId,
            userId: String(req.user._id),
        });

        try {
            const data = await this.stripeService.getSubscriptionStatus(
                req.user._id,
            );

            this.logger.info("Subscription status read", {
                requestId: req.requestId,
                userId: String(req.user._id),
                hasSubscription: data.hasSubscription,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: data.hasSubscription
                    ? STRIPE_MESSAGES.SUBSCRIPTION_FOUND
                    : STRIPE_MESSAGES.NO_SUBSCRIPTION_FOUND,
                data,
            });
        } catch (error) {
            this.logger.error("Subscription status read failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    async checkSessionAndPlan(req, res, next) {
        const { stripeSessionId } = req.query;

        this.logger.info("Request to check a stripe session", {
            requestId: req.requestId,
            userId: String(req.user._id),
            stripeSessionId,
        });

        if (!stripeSessionId) {
            return next(
                createHttpError(400, STRIPE_MESSAGES.SESSION_ID_REQUIRED),
            );
        }

        try {
            const data =
                await this.stripeService.checkSessionPresence(stripeSessionId);

            this.logger.info("Stripe session presence checked", {
                requestId: req.requestId,
                userId: String(req.user._id),
                presentInOrder: data.presentInOrder,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_MESSAGES.PRESENCE_CHECK_COMPLETED,
                data,
            });
        } catch (error) {
            this.logger.error("Stripe session presence check failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    async getUserSubscriptionStatus(req, res, next) {
        this.logger.info("Request for the user subscription status", {
            requestId: req.requestId,
            userId: String(req.user._id),
        });

        try {
            const data = await this.stripeService.getUserSubscriptionStatus(
                req.user._id,
            );

            this.logger.info("User subscription status read", {
                requestId: req.requestId,
                userId: String(req.user._id),
                subscriptionStatus: data.subscriptionStatus,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: data.subscription
                    ? STRIPE_MESSAGES.HAS_ACTIVE_SUBSCRIPTION
                    : STRIPE_MESSAGES.HAS_NO_ACTIVE_SUBSCRIPTION,
                data,
            });
        } catch (error) {
            this.logger.error("User subscription status read failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    async getInvoices(req, res, next) {
        this.logger.info("Request for stripe invoices", {
            requestId: req.requestId,
            userId: String(req.user._id),
        });

        try {
            const data = await this.stripeService.getInvoices(req.user._id);

            this.logger.info("Invoices read", {
                requestId: req.requestId,
                userId: String(req.user._id),
                count: data.invoices.length,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_MESSAGES.INVOICES_FETCHED,
                data,
            });
        } catch (error) {
            this.logger.error("Invoices read failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    async cancelSubscription(req, res, next) {
        const { cancelAtPeriodEnd = true } = req.body;

        this.logger.info("Request to cancel a subscription", {
            requestId: req.requestId,
            userId: String(req.user._id),
            cancelAtPeriodEnd,
        });

        try {
            const { subscription, cancelReason, wouldHaveStayedIfOffered } =
                await this.stripeService.cancelSubscription({
                    userId: req.user._id,
                    cancelAtPeriodEnd,
                    body: req.body,
                });

            this.logger.info("Subscription cancellation resolved", {
                requestId: req.requestId,
                userId: String(req.user._id),
                subscriptionId: String(subscription._id),
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: cancelAtPeriodEnd
                    ? STRIPE_MESSAGES.SUBSCRIPTION_CANCEL_AT_PERIOD_END
                    : STRIPE_MESSAGES.SUBSCRIPTION_CANCELED_IMMEDIATELY,
                data: {
                    subscription: {
                        id: subscription._id,
                        status: subscription.status,
                        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                        cancelAt: subscription.cancelAt,
                        cancelReason,
                        wouldHaveStayedIfOffered,
                    },
                },
            });
        } catch (error) {
            this.logger.error("Subscription cancellation failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }

    async completeTrialTransition(req, res) {
        this.logger.info("Request to end a trial", {
            requestId: req.requestId,
            userId: String(req.user._id),
        });

        const result = await this.stripeService.completeTrialTransition(
            req.user._id,
        );

        this.logger.info("Trial transition resolved", {
            requestId: req.requestId,
            userId: String(req.user._id),
            statusCode: result.statusCode,
            action: result.data?.action,
        });

        return sendResponse(res, result);
    }

    async getAssessmentIdBySessionOrOrder(req, res, next) {
        const { sessionId, orderId } = req.query;

        this.logger.info("Request for an assessment id", {
            requestId: req.requestId,
            userId: String(req.user._id),
            sessionId,
            orderId,
        });

        if (!sessionId && !orderId) {
            return next(
                createHttpError(400, STRIPE_MESSAGES.SESSION_OR_ORDER_REQUIRED),
            );
        }

        if (sessionId && orderId) {
            return next(
                createHttpError(
                    400,
                    STRIPE_MESSAGES.SESSION_AND_ORDER_EXCLUSIVE,
                ),
            );
        }

        try {
            const assessmentId =
                await this.stripeService.findAssessmentIdBySessionOrOrder({
                    sessionId,
                    orderId,
                });

            if (!assessmentId) {
                this.logger.warn("Assessment id not found for the order", {
                    requestId: req.requestId,
                    userId: String(req.user._id),
                });

                return sendResponse(res, {
                    statusCode: 404,
                    status: RESPONSE_STATUS.ERROR,
                    message: STRIPE_MESSAGES.ORDER_NOT_FOUND,
                    data: { found: false, assessmentId: null },
                });
            }

            this.logger.info("Assessment id resolved", {
                requestId: req.requestId,
                userId: String(req.user._id),
                assessmentId: String(assessmentId),
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_MESSAGES.ASSESSMENT_ID_RETRIEVED,
                data: { found: true, assessmentId },
            });
        } catch (error) {
            this.logger.error("Assessment id read failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                reason: error.message,
            });

            return next(error);
        }
    }
}

module.exports = { StripeController };
