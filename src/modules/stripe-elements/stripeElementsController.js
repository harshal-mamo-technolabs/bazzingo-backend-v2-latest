const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    ORDER_STATUSES,
    STRIPE_ELEMENTS_MESSAGES,
    STRIPE_ELEMENTS_DYNAMIC_MESSAGES,
    STRIPE_ELEMENTS_DEFAULTS,
    STRIPE_ELEMENTS_PRICE_TYPES,
    STRIPE_ELEMENTS_ITEM_TYPES,
    STRIPE_ELEMENTS_RESPONSE_STATUS,
    STRIPE_ELEMENTS_FLOWS,
    STRIPE_ELEMENTS_PAY_OUTCOMES,
    STRIPE_ELEMENTS_CANCELLATION_METADATA_KEYS,
    STRIPE_ELEMENTS_ERROR_TYPES,
    STRIPE_ELEMENTS_ERROR_CODES,
    STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES,
    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES,
    STRIPE_ELEMENTS_ORDER_STATUS_BY_PAYMENT_INTENT,
    STRIPE_ELEMENTS_GENERIC_ORDER_STATUS_BY_PAYMENT_INTENT,
} = require("../../constants");

const toISO = (seconds) =>
    seconds ? new Date(seconds * 1000).toISOString() : null;

const httpErrorFrom = (error, fallbackMessage) =>
    createHttpError.isHttpError(error)
        ? error
        : createHttpError(500, error.message || fallbackMessage);

class StripeElementsController {
    constructor(stripeElementsService, logger) {
        this.stripeElementsService = stripeElementsService;
        this.logger = logger;
    }

    ensureStripe(req, next) {
        if (this.stripeElementsService.isConfigured()) {
            return true;
        }

        this.logger.error("Stripe elements request without a stripe client", {
            requestId: req.requestId,
            userId: req.user ? String(req.user._id) : null,
            path: req.originalUrl,
        });

        next(createHttpError(500, STRIPE_ELEMENTS_MESSAGES.NOT_CONFIGURED));

        return false;
    }

    validateCancellationSurvey(body) {
        const { cancelReason, wouldHaveStayedIfOffered } = body || {};
        const max = STRIPE_ELEMENTS_DEFAULTS.METADATA_VALUE_MAX;

        if (typeof cancelReason !== "string") {
            throw createHttpError(
                400,
                STRIPE_ELEMENTS_MESSAGES.CANCEL_REASON_STRING,
            );
        }

        const reason = cancelReason.trim();

        if (!reason) {
            throw createHttpError(
                400,
                STRIPE_ELEMENTS_MESSAGES.CANCEL_REASON_NON_EMPTY,
            );
        }

        if (reason.length > max) {
            throw createHttpError(
                400,
                STRIPE_ELEMENTS_DYNAMIC_MESSAGES.cancelReasonTooLong(max),
            );
        }

        if (
            !Array.isArray(wouldHaveStayedIfOffered) ||
            wouldHaveStayedIfOffered.length === 0
        ) {
            throw createHttpError(
                400,
                STRIPE_ELEMENTS_MESSAGES.STAY_IF_OFFERED_ARRAY,
            );
        }

        const items = [];

        for (const entry of wouldHaveStayedIfOffered) {
            if (typeof entry !== "string") {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.STAY_IF_OFFERED_STRINGS,
                );
            }

            const trimmed = entry.trim();

            if (!trimmed) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.STAY_IF_OFFERED_NON_EMPTY,
                );
            }

            items.push(trimmed);
        }

        const unique = [...new Set(items)];

        if (JSON.stringify(unique).length > max) {
            throw createHttpError(
                400,
                STRIPE_ELEMENTS_DYNAMIC_MESSAGES.stayIfOfferedTooLong(max),
            );
        }

        return { cancelReason: reason, wouldHaveStayedIfOffered: unique };
    }

    async getConfig(req, res) {
        this.logger.info("Request for the stripe elements configuration", {
            requestId: req.requestId,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: STRIPE_ELEMENTS_MESSAGES.CONFIG_RETRIEVED,
            data: {
                publishableKey: this.stripeElementsService.getPublishableKey(),
            },
        });
    }

    async getDefaultConfig(req, res) {
        this.logger.info("Request for the stripe elements default values", {
            requestId: req.requestId,
        });

        const defaults = this.stripeElementsService.getDefaultConfig();

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: STRIPE_ELEMENTS_MESSAGES.DEFAULT_CONFIG_RETRIEVED,
            data: {
                ...defaults,
                env: this.stripeElementsService.getConfiguredEnv(),
            },
        });
    }

    async createSubscription(req, res, next) {
        const user = req.user;
        const {
            priceId,
            recurringPriceId,
            trialPriceId,
            withTrial = false,
            trialDays,
        } = req.body;

        this.logger.info("Request to create a subscription setup intent", {
            requestId: req.requestId,
            userId: String(user._id),
            withTrial: Boolean(withTrial),
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        const defaults = this.stripeElementsService.getDefaultConfig();
        const finalRecurringPriceId =
            recurringPriceId || priceId || defaults.recurringPriceId;
        const finalTrialPriceId = trialPriceId || defaults.trialPriceId;
        const finalTrialDays = trialDays || defaults.trialDays;

        if (!finalRecurringPriceId) {
            this.logger.warn("Subscription setup intent is missing a price", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.RECURRING_PRICE_ID_REQUIRED,
                ),
            );
        }

        if (withTrial && !finalTrialPriceId) {
            this.logger.warn(
                "Subscription setup intent is missing a trial price",
                { requestId: req.requestId, userId: String(user._id) },
            );

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.TRIAL_PRICE_ID_REQUIRED,
                ),
            );
        }

        try {
            const recurringPrice =
                await this.stripeElementsService.retrievePrice(
                    finalRecurringPriceId,
                );

            if (!recurringPrice.active) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.RECURRING_PRICE_INACTIVE,
                );
            }

            if (recurringPrice.type !== STRIPE_ELEMENTS_PRICE_TYPES.RECURRING) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.RECURRING_PRICE_TYPE,
                );
            }

            let trialPrice = null;

            if (withTrial) {
                trialPrice =
                    await this.stripeElementsService.retrievePrice(
                        finalTrialPriceId,
                    );

                if (!trialPrice.active) {
                    throw createHttpError(
                        400,
                        STRIPE_ELEMENTS_MESSAGES.TRIAL_PRICE_INACTIVE,
                    );
                }

                if (trialPrice.type !== STRIPE_ELEMENTS_PRICE_TYPES.ONE_TIME) {
                    throw createHttpError(
                        400,
                        STRIPE_ELEMENTS_MESSAGES.TRIAL_PRICE_TYPE,
                    );
                }
            }

            const customerId =
                await this.stripeElementsService.ensureSubscriptionCustomer(
                    user,
                );
            const setupIntent =
                await this.stripeElementsService.createSetupIntent({
                    user,
                    customerId,
                    recurringPriceId: finalRecurringPriceId,
                    withTrial,
                    trialPriceId: finalTrialPriceId,
                    trialDays: finalTrialDays,
                });

            this.logger.info("Subscription setup intent ready", {
                requestId: req.requestId,
                userId: String(user._id),
                setupIntentId: setupIntent.id,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: withTrial
                    ? STRIPE_ELEMENTS_DYNAMIC_MESSAGES.setupIntentWithTrialCreated(
                          finalTrialDays,
                      )
                    : STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_CREATED,
                data: {
                    setupIntentId: setupIntent.id,
                    clientSecret: setupIntent.client_secret,
                    customerId,
                    userId: user._id.toString(),
                    recurringPriceId: finalRecurringPriceId,
                    recurringAmount: recurringPrice.unit_amount,
                    currency: recurringPrice.currency,
                    withTrial,
                    trialPriceId: withTrial ? finalTrialPriceId : null,
                    trialAmount: withTrial ? trialPrice.unit_amount : null,
                    trialDays: withTrial ? finalTrialDays : null,
                    immediateAmount:
                        withTrial && trialPrice
                            ? trialPrice.unit_amount
                            : recurringPrice.unit_amount,
                    publishableKey:
                        this.stripeElementsService.getPublishableKey(),
                    nextStep: STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_NEXT_STEP,
                },
            });
        } catch (error) {
            this.logger.error("Creating the subscription setup intent failed", {
                requestId: req.requestId,
                userId: String(user._id),
                reason: error.message,
            });

            if (error.type === STRIPE_ELEMENTS_ERROR_TYPES.INVALID_REQUEST) {
                if (
                    error.code === STRIPE_ELEMENTS_ERROR_CODES.RESOURCE_MISSING
                ) {
                    return next(
                        createHttpError(
                            404,
                            STRIPE_ELEMENTS_DYNAMIC_MESSAGES.stripeResourceNotFound(
                                error.message,
                            ),
                        ),
                    );
                }

                return next(createHttpError(400, error.message));
            }

            return next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_FAILED,
                ),
            );
        }
    }

    async activateSubscription(req, res, next) {
        const user = req.user;
        const {
            setupIntentId,
            recurringPriceId,
            withTrial,
            trialPriceId,
            trialDays,
        } = req.body;

        this.logger.info("Request to activate a subscription", {
            requestId: req.requestId,
            userId: String(user._id),
            setupIntentId,
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!setupIntentId) {
            this.logger.warn("Subscription activation is missing an intent", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_ID_REQUIRED,
                ),
            );
        }

        try {
            const setupIntent =
                await this.stripeElementsService.retrieveSetupIntent(
                    setupIntentId,
                );

            if (setupIntent.status !== "succeeded") {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_DYNAMIC_MESSAGES.setupIntentNotConfirmed(
                        setupIntent.status,
                    ),
                );
            }

            const paymentMethodId = setupIntent.payment_method;
            const customerId = setupIntent.customer;

            if (user.stripeCustomerId && customerId !== user.stripeCustomerId) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_NOT_OWNED,
                );
            }

            // Activation resumes this checkout, not the user's past email history.
            user.$locals.purchaseAttribution = {
                flowId: setupIntent.metadata?.flow_id,
                utmEmail: setupIntent.metadata?.utm_email,
                utmCampaign: setupIntent.metadata?.utm_campaign,
                utmMedium: setupIntent.metadata?.utm_medium,
            };

            const finalRecurringPriceId =
                recurringPriceId || setupIntent.metadata?.recurringPriceId;
            const finalWithTrial =
                withTrial !== undefined
                    ? withTrial
                    : setupIntent.metadata?.withTrial === "true";
            const finalTrialPriceId =
                trialPriceId || setupIntent.metadata?.trialPriceId;
            const finalTrialDays =
                trialDays ||
                parseInt(setupIntent.metadata?.trialDays, 10) ||
                this.stripeElementsService.getDefaultConfig().trialDays;

            if (!paymentMethodId) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_NO_PAYMENT_METHOD,
                );
            }

            if (!customerId) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_NO_CUSTOMER,
                );
            }

            if (!finalRecurringPriceId) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.RECURRING_PRICE_ID_MISSING,
                );
            }

            await this.stripeElementsService.saveDefaultPaymentMethod(
                user,
                customerId,
                paymentMethodId,
            );

            const subscription =
                await this.stripeElementsService.createSubscriptionForUser({
                    user,
                    customerId,
                    paymentMethodId,
                    setupIntentId,
                    recurringPriceId: finalRecurringPriceId,
                    withTrial: finalWithTrial,
                    trialPriceId: finalTrialPriceId,
                    trialDays: finalTrialDays,
                });

            const { clientSecret, paymentIntentId, paymentStatus } =
                await this.stripeElementsService.resolveSubscriptionPayment(
                    subscription,
                    customerId,
                    paymentMethodId,
                );

            const trialInfo = finalWithTrial
                ? {
                      withTrial: true,
                      trialPriceId: finalTrialPriceId,
                      trialDays: finalTrialDays,
                      trialEnd: toISO(subscription.trial_end),
                  }
                : { withTrial: false };

            this.logger.info("Subscription activated", {
                requestId: req.requestId,
                userId: String(user._id),
                subscriptionId: subscription.id,
                status: subscription.status,
            });

            if (
                subscription.status ===
                    STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.ACTIVE ||
                subscription.status ===
                    STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.TRIALING
            ) {
                return sendResponse(res, {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message:
                        subscription.status ===
                        STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.TRIALING
                            ? STRIPE_ELEMENTS_DYNAMIC_MESSAGES.trialStarted(
                                  new Date(
                                      subscription.trial_end * 1000,
                                  ).toLocaleDateString(),
                              )
                            : STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_CREATED,
                    data: {
                        subscriptionId: subscription.id,
                        status: subscription.status,
                        customerId,
                        recurringPriceId: finalRecurringPriceId,
                        currentPeriodStart: toISO(
                            subscription.current_period_start,
                        ),
                        currentPeriodEnd: toISO(
                            subscription.current_period_end,
                        ),
                        requiresAction: false,
                        paymentMethodId,
                        ...trialInfo,
                    },
                });
            }

            if (
                subscription.status ===
                    STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.INCOMPLETE &&
                clientSecret
            ) {
                return sendResponse(res, {
                    statusCode: 200,
                    status: STRIPE_ELEMENTS_RESPONSE_STATUS.REQUIRES_ACTION,
                    message: finalWithTrial
                        ? STRIPE_ELEMENTS_DYNAMIC_MESSAGES.confirmTrialPayment(
                              finalTrialDays,
                          )
                        : STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_CONFIRM_PAYMENT,
                    data: {
                        subscriptionId: subscription.id,
                        status: subscription.status,
                        customerId,
                        recurringPriceId: finalRecurringPriceId,
                        requiresAction: true,
                        clientSecret,
                        paymentIntentId,
                        ...trialInfo,
                        paymentStatus,
                        paymentMethodId,
                    },
                });
            }

            return sendResponse(res, {
                statusCode: 200,
                status: STRIPE_ELEMENTS_RESPONSE_STATUS.PENDING,
                message: STRIPE_ELEMENTS_DYNAMIC_MESSAGES.subscriptionStatus(
                    subscription.status,
                ),
                data: {
                    subscriptionId: subscription.id,
                    status: subscription.status,
                    customerId,
                    recurringPriceId: finalRecurringPriceId,
                    requiresAction:
                        subscription.status ===
                        STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.INCOMPLETE,
                    clientSecret,
                    paymentIntentId,
                    paymentMethodId,
                    ...trialInfo,
                },
            });
        } catch (error) {
            this.logger.error("Activating the subscription failed", {
                requestId: req.requestId,
                userId: String(user._id),
                reason: error.message,
            });

            if (error.type === STRIPE_ELEMENTS_ERROR_TYPES.INVALID_REQUEST) {
                return next(createHttpError(400, error.message));
            }

            return next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.ACTIVATION_FAILED,
                ),
            );
        }
    }

    async getSubscriptionStatus(req, res, next) {
        const user = req.user;
        const { subscriptionId } = req.params;

        this.logger.info("Request for a subscription status", {
            requestId: req.requestId,
            userId: String(user._id),
            subscriptionId,
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!subscriptionId) {
            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_ID_REQUIRED,
                ),
            );
        }

        if (
            !subscriptionId.startsWith(
                STRIPE_ELEMENTS_DEFAULTS.SUBSCRIPTION_ID_PREFIX,
            )
        ) {
            this.logger.warn("Subscription status asked with a bad id", {
                requestId: req.requestId,
                userId: String(user._id),
                subscriptionId,
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_ID_INVALID,
                ),
            );
        }

        try {
            const subscription =
                await this.stripeElementsService.retrieveSubscription(
                    subscriptionId,
                    {
                        expand: [
                            "latest_invoice.payment_intent",
                            "default_payment_method",
                        ],
                    },
                );

            if (
                user.stripeCustomerId &&
                subscription.customer !== user.stripeCustomerId
            ) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_NOT_OWNED,
                );
            }

            const paymentIntent = subscription.latest_invoice?.payment_intent;
            const requiresAction =
                paymentIntent?.status ===
                STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION;

            const trialInfo = subscription.trial_end
                ? {
                      withTrial: true,
                      trialStart: toISO(subscription.trial_start),
                      trialEnd: toISO(subscription.trial_end),
                      isInTrial:
                          subscription.status ===
                          STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.TRIALING,
                  }
                : { withTrial: false, isInTrial: false };

            this.logger.info("Subscription status resolved", {
                requestId: req.requestId,
                userId: String(user._id),
                subscriptionId,
                status: subscription.status,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_STATUS_RETRIEVED,
                data: {
                    subscriptionId: subscription.id,
                    status: subscription.status,
                    customerId: subscription.customer,
                    currentPeriodStart: toISO(
                        subscription.current_period_start,
                    ),
                    currentPeriodEnd: toISO(subscription.current_period_end),
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    paymentStatus: paymentIntent?.status || null,
                    requiresAction,
                    actionClientSecret: requiresAction
                        ? paymentIntent.client_secret
                        : null,
                    defaultPaymentMethod: subscription.default_payment_method
                        ? typeof subscription.default_payment_method ===
                          "string"
                            ? subscription.default_payment_method
                            : subscription.default_payment_method.id
                        : null,
                    ...trialInfo,
                },
            });
        } catch (error) {
            this.logger.error("Reading the subscription status failed", {
                requestId: req.requestId,
                userId: String(user._id),
                subscriptionId,
                reason: error.message,
            });

            if (
                error.type === STRIPE_ELEMENTS_ERROR_TYPES.INVALID_REQUEST &&
                error.code === STRIPE_ELEMENTS_ERROR_CODES.RESOURCE_MISSING
            ) {
                return next(
                    createHttpError(
                        404,
                        STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_NOT_FOUND,
                    ),
                );
            }

            return next(
                createHttpError(
                    500,
                    error.message ||
                        STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_STATUS_FAILED,
                ),
            );
        }
    }

    async confirmSubscription(req, res, next) {
        const user = req.user;
        const { subscriptionId, paymentIntentId } = req.body;

        this.logger.info("Request to confirm a subscription", {
            requestId: req.requestId,
            userId: String(user._id),
            subscriptionId,
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!subscriptionId) {
            this.logger.warn("Subscription confirmation is missing an id", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_ID_REQUIRED,
                ),
            );
        }

        try {
            const subscription =
                await this.stripeElementsService.retrieveSubscription(
                    subscriptionId,
                    {
                        expand: [
                            "latest_invoice.payment_intent",
                            "default_payment_method",
                        ],
                    },
                );

            if (
                user.stripeCustomerId &&
                subscription.customer !== user.stripeCustomerId
            ) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_NOT_OWNED,
                );
            }

            const paymentIntent = subscription.latest_invoice?.payment_intent;

            if (paymentIntentId && paymentIntent?.id !== paymentIntentId) {
                this.logger.warn("Payment intent id mismatch on confirmation", {
                    requestId: req.requestId,
                    userId: String(user._id),
                    expected: paymentIntent?.id || null,
                    received: paymentIntentId,
                });
            }

            if (
                subscription.status ===
                STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.ACTIVE
            ) {
                return sendResponse(res, {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message: STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_ACTIVE,
                    data: {
                        subscriptionId: subscription.id,
                        status: subscription.status,
                        customerId: subscription.customer,
                        currentPeriodEnd: toISO(
                            subscription.current_period_end,
                        ),
                        paymentStatus:
                            STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.SUCCEEDED,
                    },
                });
            }

            if (
                subscription.status ===
                STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.TRIALING
            ) {
                return sendResponse(res, {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message: STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_TRIALING,
                    data: {
                        subscriptionId: subscription.id,
                        status: subscription.status,
                        customerId: subscription.customer,
                        trialEnd: toISO(subscription.trial_end),
                    },
                });
            }

            if (
                subscription.status ===
                STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.INCOMPLETE
            ) {
                if (
                    paymentIntent?.status ===
                    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION
                ) {
                    return sendResponse(res, {
                        statusCode: 200,
                        status: STRIPE_ELEMENTS_RESPONSE_STATUS.REQUIRES_ACTION,
                        message:
                            STRIPE_ELEMENTS_MESSAGES.THREE_DS_STILL_REQUIRED,
                        data: {
                            subscriptionId: subscription.id,
                            status: subscription.status,
                            requiresAction: true,
                            clientSecret: paymentIntent.client_secret,
                            paymentIntentId: paymentIntent.id,
                        },
                    });
                }

                if (
                    paymentIntent?.status ===
                    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_PAYMENT_METHOD
                ) {
                    return sendResponse(res, {
                        statusCode: 400,
                        status: RESPONSE_STATUS.ERROR,
                        message:
                            STRIPE_ELEMENTS_MESSAGES.PAYMENT_METHOD_REQUIRED,
                        data: {
                            subscriptionId: subscription.id,
                            status: subscription.status,
                            paymentStatus: paymentIntent.status,
                            lastError:
                                paymentIntent.last_payment_error?.message ||
                                null,
                        },
                    });
                }

                if (
                    paymentIntent?.status ===
                    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.PROCESSING
                ) {
                    return sendResponse(res, {
                        statusCode: 200,
                        status: STRIPE_ELEMENTS_RESPONSE_STATUS.PROCESSING,
                        message:
                            STRIPE_ELEMENTS_MESSAGES.PAYMENT_STILL_PROCESSING,
                        data: {
                            subscriptionId: subscription.id,
                            status: subscription.status,
                            paymentStatus:
                                STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.PROCESSING,
                        },
                    });
                }
            }

            return sendResponse(res, {
                statusCode: 200,
                status: STRIPE_ELEMENTS_RESPONSE_STATUS.PENDING,
                message: STRIPE_ELEMENTS_DYNAMIC_MESSAGES.subscriptionStatus(
                    subscription.status,
                ),
                data: {
                    subscriptionId: subscription.id,
                    status: subscription.status,
                    customerId: subscription.customer,
                    paymentStatus: paymentIntent?.status || "unknown",
                },
            });
        } catch (error) {
            this.logger.error("Confirming the subscription failed", {
                requestId: req.requestId,
                userId: String(user._id),
                subscriptionId,
                reason: error.message,
            });

            if (
                error.type === STRIPE_ELEMENTS_ERROR_TYPES.INVALID_REQUEST &&
                error.code === STRIPE_ELEMENTS_ERROR_CODES.RESOURCE_MISSING
            ) {
                return next(
                    createHttpError(
                        404,
                        STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_NOT_FOUND,
                    ),
                );
            }

            return next(
                createHttpError(
                    500,
                    error.message ||
                        STRIPE_ELEMENTS_MESSAGES.CONFIRMATION_FAILED,
                ),
            );
        }
    }

    async cancelSubscription(req, res, next) {
        const user = req.user;
        const { subscriptionId, cancelImmediately = false } = req.body;

        this.logger.info("Request to cancel a subscription", {
            requestId: req.requestId,
            userId: String(user._id),
            subscriptionId,
            cancelImmediately: Boolean(cancelImmediately),
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!subscriptionId) {
            this.logger.warn("Subscription cancellation is missing an id", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_ID_REQUIRED,
                ),
            );
        }

        const { cancelReason, wouldHaveStayedIfOffered } =
            this.validateCancellationSurvey(req.body);

        const metadataPatch = {
            [STRIPE_ELEMENTS_CANCELLATION_METADATA_KEYS.CANCEL_REASON]:
                cancelReason,
            [STRIPE_ELEMENTS_CANCELLATION_METADATA_KEYS.STAY_IF_OFFERED]:
                JSON.stringify(wouldHaveStayedIfOffered),
        };

        try {
            const existingSubscription =
                await this.stripeElementsService.retrieveSubscription(
                    subscriptionId,
                );

            if (
                user.stripeCustomerId &&
                existingSubscription.customer !== user.stripeCustomerId
            ) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_NOT_OWNED,
                );
            }

            const metadata = {
                ...(existingSubscription.metadata || {}),
                ...metadataPatch,
            };

            const subscription =
                await this.stripeElementsService.cancelSubscription(
                    subscriptionId,
                    metadata,
                    cancelImmediately,
                );

            await this.stripeElementsService.saveSubscriptionCancellation({
                subscriptionId,
                subscription,
                cancelReason,
                wouldHaveStayedIfOffered,
                metadata,
            });

            this.logger.info("Subscription cancellation stored", {
                requestId: req.requestId,
                userId: String(user._id),
                subscriptionId,
                status: subscription.status,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: cancelImmediately
                    ? STRIPE_ELEMENTS_MESSAGES.CANCELLED_IMMEDIATELY
                    : STRIPE_ELEMENTS_MESSAGES.CANCELLED_AT_PERIOD_END,
                data: {
                    subscriptionId: subscription.id,
                    cancelReason,
                    wouldHaveStayedIfOffered,
                    status: subscription.status,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    cancelAt: toISO(subscription.cancel_at),
                    currentPeriodEnd: toISO(subscription.current_period_end),
                },
            });
        } catch (error) {
            this.logger.error("Cancelling the subscription failed", {
                requestId: req.requestId,
                userId: String(user._id),
                subscriptionId,
                reason: error.message,
            });

            if (
                error.type === STRIPE_ELEMENTS_ERROR_TYPES.INVALID_REQUEST &&
                error.code === STRIPE_ELEMENTS_ERROR_CODES.RESOURCE_MISSING
            ) {
                return next(
                    createHttpError(
                        404,
                        STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTION_NOT_FOUND,
                    ),
                );
            }

            return next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.CANCELLATION_FAILED,
                ),
            );
        }
    }

    async getUserSubscriptions(req, res, next) {
        const user = req.user;

        this.logger.info("Request for the subscriptions of a user", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        try {
            const dbSubscriptions =
                await this.stripeElementsService.findUserSubscriptions(
                    user._id,
                );

            let stripeSubscriptions = [];

            if (user.stripeCustomerId) {
                const stripeResult =
                    await this.stripeElementsService.listStripeSubscriptions(
                        user.stripeCustomerId,
                    );

                stripeSubscriptions = stripeResult.data.map((subscription) => ({
                    subscriptionId: subscription.id,
                    status: subscription.status,
                    currentPeriodStart: toISO(
                        subscription.current_period_start,
                    ),
                    currentPeriodEnd: toISO(subscription.current_period_end),
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    cancelAt: toISO(subscription.cancel_at),
                    trialStart: toISO(subscription.trial_start),
                    trialEnd: toISO(subscription.trial_end),
                    priceId: subscription.items?.data?.[0]?.price?.id || null,
                    amount:
                        subscription.items?.data?.[0]?.price?.unit_amount ||
                        null,
                    currency:
                        subscription.items?.data?.[0]?.price?.currency || null,
                    interval:
                        subscription.items?.data?.[0]?.price?.recurring
                            ?.interval || null,
                    defaultPaymentMethod: subscription.default_payment_method
                        ? typeof subscription.default_payment_method ===
                          "string"
                            ? subscription.default_payment_method
                            : {
                                  id: subscription.default_payment_method.id,
                                  brand: subscription.default_payment_method
                                      .card?.brand,
                                  last4: subscription.default_payment_method
                                      .card?.last4,
                                  expMonth:
                                      subscription.default_payment_method.card
                                          ?.exp_month,
                                  expYear:
                                      subscription.default_payment_method.card
                                          ?.exp_year,
                              }
                        : null,
                    metadata: subscription.metadata,
                }));
            }

            this.logger.info("Subscriptions of the user resolved", {
                requestId: req.requestId,
                userId: String(user._id),
                dbCount: dbSubscriptions.length,
                stripeCount: stripeSubscriptions.length,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTIONS_RETRIEVED,
                data: {
                    userId: user._id,
                    stripeCustomerId: user.stripeCustomerId || null,
                    dbSubscriptions: dbSubscriptions.map((subscription) => ({
                        ...subscription,
                        _id: subscription._id.toString(),
                        userId: subscription.userId?.toString() || null,
                    })),
                    stripeSubscriptions,
                    summary: {
                        totalDbSubscriptions: dbSubscriptions.length,
                        totalStripeSubscriptions: stripeSubscriptions.length,
                        activeSubscriptions: stripeSubscriptions.filter(
                            (subscription) =>
                                subscription.status ===
                                    STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.ACTIVE ||
                                subscription.status ===
                                    STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES.TRIALING,
                        ).length,
                    },
                },
            });
        } catch (error) {
            this.logger.error("Reading the subscriptions of the user failed", {
                requestId: req.requestId,
                userId: String(user._id),
                reason: error.message,
            });

            return next(
                createHttpError(
                    500,
                    error.message ||
                        STRIPE_ELEMENTS_MESSAGES.SUBSCRIPTIONS_FAILED,
                ),
            );
        }
    }

    async createPayment(req, res, next) {
        const user = req.user;
        const { assessmentId, priceCatalogId } = req.body;

        this.logger.info("Request to create an assessment payment", {
            requestId: req.requestId,
            userId: String(user._id),
            assessmentId,
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!assessmentId) {
            this.logger.warn("Assessment payment is missing an assessment", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.ASSESSMENT_ID_REQUIRED,
                ),
            );
        }

        try {
            const context =
                await this.stripeElementsService.resolveAssessmentPaymentContext(
                    assessmentId,
                    priceCatalogId,
                );
            const price =
                await this.stripeElementsService.resolveActiveOneTimePriceCatalog(
                    context.stripeProductId,
                    priceCatalogId,
                );
            const customerId =
                await this.stripeElementsService.getOrCreatePaymentCustomer(
                    user,
                );

            const order = await this.stripeElementsService.createOrder({
                userId: user._id,
                assessmentId: context.orderAssessmentId,
                priceCatalogId: price._id,
                currency: price.currency,
                unitAmount: price.unitAmount,
                status: ORDER_STATUSES.REQUIRES_PAYMENT_METHOD,
                stripeCustomerId: customerId,
            });

            const paymentIntent =
                await this.stripeElementsService.createAssessmentPaymentIntent({
                    user,
                    order,
                    customerId,
                    price,
                    context,
                });

            await this.stripeElementsService.saveOrderPaymentIntent(
                order,
                paymentIntent.id,
            );

            this.logger.info("Assessment payment intent created", {
                requestId: req.requestId,
                userId: String(user._id),
                orderId: String(order._id),
                paymentIntentId: paymentIntent.id,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.PAYMENT_INTENT_CREATED,
                data: {
                    orderId: order._id.toString(),
                    paymentIntentId: paymentIntent.id,
                    clientSecret: paymentIntent.client_secret,
                    amount: price.unitAmount,
                    currency: price.currency,
                    assessmentId: context.orderAssessmentId.toString(),
                    assessmentKind: context.assessmentKind,
                    assessmentName: context.assessmentDisplayName,
                    customerId,
                    nextStep: STRIPE_ELEMENTS_MESSAGES.PAYMENT_INTENT_NEXT_STEP,
                },
            });
        } catch (error) {
            this.logger.error("Creating the assessment payment failed", {
                requestId: req.requestId,
                userId: String(user._id),
                assessmentId,
                reason: error.message,
            });

            if (error.type === STRIPE_ELEMENTS_ERROR_TYPES.INVALID_REQUEST) {
                return next(createHttpError(400, error.message));
            }

            return next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.PAYMENT_CREATION_FAILED,
                ),
            );
        }
    }

    async getPaymentStatus(req, res, next) {
        const user = req.user;
        const { orderId } = req.params;

        this.logger.info("Request for a payment status", {
            requestId: req.requestId,
            userId: String(user._id),
            orderId,
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!orderId) {
            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.ORDER_ID_REQUIRED,
                ),
            );
        }

        try {
            const order =
                await this.stripeElementsService.findOrderWithAssessment(
                    orderId,
                );

            if (!order) {
                throw createHttpError(
                    404,
                    STRIPE_ELEMENTS_MESSAGES.ORDER_NOT_FOUND,
                );
            }

            if (order.userId.toString() !== user._id.toString()) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.ORDER_NOT_OWNED,
                );
            }

            let paymentIntent = null;

            if (order.stripePaymentIntentId) {
                paymentIntent =
                    await this.stripeElementsService.retrievePaymentIntent(
                        order.stripePaymentIntentId,
                    );

                if (paymentIntent.status !== order.status) {
                    const newStatus =
                        STRIPE_ELEMENTS_ORDER_STATUS_BY_PAYMENT_INTENT[
                            paymentIntent.status
                        ] || order.status;

                    if (newStatus !== order.status) {
                        await this.stripeElementsService.updateOrderStatus(
                            orderId,
                            newStatus,
                        );
                        order.status = newStatus;
                    }
                }
            }

            this.logger.info("Payment status resolved", {
                requestId: req.requestId,
                userId: String(user._id),
                orderId,
                status: order.status,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.PAYMENT_STATUS_RETRIEVED,
                data: {
                    orderId: order._id.toString(),
                    status: order.status,
                    paymentIntentId: order.stripePaymentIntentId,
                    paymentStatus: paymentIntent?.status || null,
                    amount: order.unitAmount,
                    currency: order.currency,
                    assessmentId: order.assessmentId?._id?.toString() || null,
                    assessmentName:
                        order.assessmentId?.mainCategory ||
                        order.assessmentId?.name ||
                        null,
                    requiresAction:
                        paymentIntent?.status ===
                        STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION,
                    clientSecret:
                        paymentIntent?.status ===
                        STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION
                            ? paymentIntent.client_secret
                            : null,
                    createdAt: order.createdAt,
                },
            });
        } catch (error) {
            this.logger.error("Reading the payment status failed", {
                requestId: req.requestId,
                userId: String(user._id),
                orderId,
                reason: error.message,
            });

            return next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.PAYMENT_STATUS_FAILED,
                ),
            );
        }
    }

    async confirmPayment(req, res, next) {
        const user = req.user;
        const { orderId, paymentIntentId } = req.body;

        this.logger.info("Request to confirm a payment", {
            requestId: req.requestId,
            userId: String(user._id),
            orderId,
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!orderId) {
            this.logger.warn("Payment confirmation is missing an order", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.ORDER_ID_REQUIRED,
                ),
            );
        }

        try {
            const order =
                await this.stripeElementsService.findOrderWithAssessment(
                    orderId,
                );

            if (!order) {
                throw createHttpError(
                    404,
                    STRIPE_ELEMENTS_MESSAGES.ORDER_NOT_FOUND,
                );
            }

            if (order.userId.toString() !== user._id.toString()) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.ORDER_NOT_OWNED,
                );
            }

            if (!order.stripePaymentIntentId) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.ORDER_WITHOUT_PAYMENT_INTENT,
                );
            }

            if (
                paymentIntentId &&
                order.stripePaymentIntentId !== paymentIntentId
            ) {
                this.logger.warn("Payment intent id mismatch on an order", {
                    requestId: req.requestId,
                    userId: String(user._id),
                    expected: order.stripePaymentIntentId,
                    received: paymentIntentId,
                });
            }

            const paymentIntent =
                await this.stripeElementsService.retrievePaymentIntent(
                    order.stripePaymentIntentId,
                );

            const newStatus =
                STRIPE_ELEMENTS_ORDER_STATUS_BY_PAYMENT_INTENT[
                    paymentIntent.status
                ] || order.status;

            await this.stripeElementsService.updateOrderStatus(
                orderId,
                newStatus,
            );

            if (
                paymentIntent.status ===
                    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.SUCCEEDED &&
                paymentIntent.payment_method &&
                !user.defaultPaymentMethodId
            ) {
                await this.stripeElementsService.setUserDefaultPaymentMethod(
                    user._id,
                    paymentIntent.payment_method,
                );
            }

            this.logger.info("Payment confirmation resolved", {
                requestId: req.requestId,
                userId: String(user._id),
                orderId,
                status: newStatus,
            });

            if (
                paymentIntent.status ===
                STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.SUCCEEDED
            ) {
                return sendResponse(res, {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message: STRIPE_ELEMENTS_MESSAGES.PAYMENT_SUCCESSFUL_BANG,
                    data: {
                        orderId: order._id.toString(),
                        status: ORDER_STATUSES.SUCCEEDED,
                        paymentIntentId: paymentIntent.id,
                        amount: order.unitAmount,
                        currency: order.currency,
                        assessmentId:
                            order.assessmentId?._id?.toString() || null,
                        assessmentName:
                            order.assessmentId?.mainCategory ||
                            order.assessmentId?.name ||
                            null,
                    },
                });
            }

            if (
                paymentIntent.status ===
                STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION
            ) {
                return sendResponse(res, {
                    statusCode: 200,
                    status: STRIPE_ELEMENTS_RESPONSE_STATUS.REQUIRES_ACTION,
                    message: STRIPE_ELEMENTS_MESSAGES.THREE_DS_REQUIRED,
                    data: {
                        orderId: order._id.toString(),
                        status: ORDER_STATUSES.REQUIRES_ACTION,
                        requiresAction: true,
                        clientSecret: paymentIntent.client_secret,
                        paymentIntentId: paymentIntent.id,
                    },
                });
            }

            if (
                paymentIntent.status ===
                STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_PAYMENT_METHOD
            ) {
                return sendResponse(res, {
                    statusCode: 400,
                    status: RESPONSE_STATUS.ERROR,
                    message: STRIPE_ELEMENTS_MESSAGES.PAYMENT_METHOD_FAILED,
                    data: {
                        orderId: order._id.toString(),
                        status: ORDER_STATUSES.REQUIRES_PAYMENT_METHOD,
                        paymentIntentId: paymentIntent.id,
                    },
                });
            }

            return sendResponse(res, {
                statusCode: 200,
                status:
                    newStatus === ORDER_STATUSES.SUCCEEDED
                        ? RESPONSE_STATUS.SUCCESS
                        : STRIPE_ELEMENTS_RESPONSE_STATUS.PENDING,
                message: STRIPE_ELEMENTS_DYNAMIC_MESSAGES.paymentStatus(
                    paymentIntent.status,
                ),
                data: {
                    orderId: order._id.toString(),
                    status: newStatus,
                    paymentIntentId: paymentIntent.id,
                    paymentStatus: paymentIntent.status,
                },
            });
        } catch (error) {
            this.logger.error("Confirming the payment failed", {
                requestId: req.requestId,
                userId: String(user._id),
                orderId,
                reason: error.message,
            });

            return next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.PAYMENT_CONFIRMATION_FAILED,
                ),
            );
        }
    }

    async getUserOrders(req, res, next) {
        const user = req.user;

        this.logger.info("Request for the orders of a user", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        try {
            const orders = await this.stripeElementsService.findUserOrders(
                user._id,
            );

            this.logger.info("Orders of the user resolved", {
                requestId: req.requestId,
                userId: String(user._id),
                total: orders.length,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.ORDERS_RETRIEVED,
                data: {
                    orders: orders.map((order) => ({
                        orderId: order._id.toString(),
                        status: order.status,
                        amount: order.unitAmount,
                        currency: order.currency,
                        assessmentId:
                            order.assessmentId?._id?.toString() || null,
                        assessmentName:
                            order.assessmentId?.mainCategory ||
                            order.assessmentId?.name ||
                            null,
                        paymentIntentId: order.stripePaymentIntentId,
                        createdAt: order.createdAt,
                    })),
                    total: orders.length,
                },
            });
        } catch (error) {
            this.logger.error("Reading the orders of the user failed", {
                requestId: req.requestId,
                userId: String(user._id),
                reason: error.message,
            });

            return next(
                createHttpError(
                    500,
                    error.message || STRIPE_ELEMENTS_MESSAGES.ORDERS_FAILED,
                ),
            );
        }
    }

    async quickPay(req, res, next) {
        const user = req.user;
        const { assessmentId, priceCatalogId, paymentMethodId } = req.body;

        this.logger.info("Request for a quick pay", {
            requestId: req.requestId,
            userId: String(user._id),
            assessmentId,
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!assessmentId) {
            this.logger.warn("Quick pay is missing an assessment", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.ASSESSMENT_ID_REQUIRED,
                ),
            );
        }

        const savedPaymentMethodId =
            paymentMethodId || user.defaultPaymentMethodId;

        if (!savedPaymentMethodId) {
            this.logger.warn("Quick pay has no payment method", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.NO_PAYMENT_METHOD,
                ),
            );
        }

        if (!user.stripeCustomerId) {
            this.logger.warn("Quick pay has no stripe customer", {
                requestId: req.requestId,
                userId: String(user._id),
            });

            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.NO_STRIPE_CUSTOMER,
                ),
            );
        }

        try {
            const assessment =
                await this.stripeElementsService.findFullAssessment(
                    assessmentId,
                );

            if (!assessment) {
                throw createHttpError(
                    404,
                    STRIPE_ELEMENTS_MESSAGES.ASSESSMENT_NOT_FOUND,
                );
            }

            if (!assessment.stripeProductId) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.ASSESSMENT_WITHOUT_PRODUCT,
                );
            }

            const price = await this.stripeElementsService.findQuickPayPrice(
                assessment.stripeProductId,
                priceCatalogId,
            );

            if (!price) {
                throw createHttpError(
                    404,
                    STRIPE_ELEMENTS_MESSAGES.NO_ACTIVE_PRICE,
                );
            }

            const order = await this.stripeElementsService.createOrder({
                userId: user._id,
                assessmentId: assessment._id,
                priceCatalogId: price._id,
                currency: price.currency,
                unitAmount: price.unitAmount,
                status: ORDER_STATUSES.PROCESSING,
                stripeCustomerId: user.stripeCustomerId,
            });

            const paymentIntent =
                await this.stripeElementsService.createQuickPayPaymentIntent({
                    user,
                    order,
                    price,
                    assessment,
                    paymentMethodId: savedPaymentMethodId,
                });

            await this.stripeElementsService.saveOrderPaymentIntent(
                order,
                paymentIntent.id,
                paymentIntent.status ===
                    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.SUCCEEDED
                    ? ORDER_STATUSES.SUCCEEDED
                    : ORDER_STATUSES.PROCESSING,
            );

            this.logger.info("Quick pay completed", {
                requestId: req.requestId,
                userId: String(user._id),
                orderId: String(order._id),
                paymentIntentId: paymentIntent.id,
                status: paymentIntent.status,
            });

            if (
                paymentIntent.status ===
                STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.SUCCEEDED
            ) {
                return sendResponse(res, {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message: STRIPE_ELEMENTS_MESSAGES.PAYMENT_SUCCESSFUL_BANG,
                    data: {
                        orderId: order._id.toString(),
                        status: ORDER_STATUSES.SUCCEEDED,
                        paymentIntentId: paymentIntent.id,
                        amount: price.unitAmount,
                        currency: price.currency,
                        assessmentId: assessment._id.toString(),
                        assessmentName:
                            assessment.mainCategory ||
                            assessment.name ||
                            STRIPE_ELEMENTS_DEFAULTS.FULL_ASSESSMENT_NAME,
                    },
                });
            }

            return sendResponse(res, {
                statusCode: 200,
                status: STRIPE_ELEMENTS_RESPONSE_STATUS.REQUIRES_ACTION,
                message: STRIPE_ELEMENTS_MESSAGES.ADDITIONAL_AUTH_REQUIRED,
                data: {
                    orderId: order._id.toString(),
                    status: paymentIntent.status,
                    paymentIntentId: paymentIntent.id,
                    clientSecret: paymentIntent.client_secret,
                    requiresAction: true,
                },
            });
        } catch (error) {
            this.logger.error("Quick pay failed", {
                requestId: req.requestId,
                userId: String(user._id),
                assessmentId,
                reason: error.message,
            });

            if (error.type === STRIPE_ELEMENTS_ERROR_TYPES.CARD) {
                return next(
                    createHttpError(
                        400,
                        error.message || STRIPE_ELEMENTS_MESSAGES.CARD_DECLINED,
                    ),
                );
            }

            return next(
                httpErrorFrom(error, STRIPE_ELEMENTS_MESSAGES.PAYMENT_FAILED),
            );
        }
    }

    async pay(req, res, next) {
        const user = req.user;
        const {
            assessmentId,
            priceCatalogId,
            amount,
            currency,
            productName,
            description,
            itemType,
            itemId,
            paymentMethodId,
        } = req.body;

        this.logger.info("Request for a one click payment", {
            requestId: req.requestId,
            userId: String(user._id),
            assessmentId: assessmentId || null,
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        try {
            let charge;
            let orderAssessmentId = null;
            let assessmentKind = null;
            let resolvedItemType = itemType || null;
            let resolvedItemId = itemId ? String(itemId) : null;

            if (assessmentId) {
                const context =
                    await this.stripeElementsService.resolveAssessmentPaymentContext(
                        assessmentId,
                        priceCatalogId,
                    );
                const price =
                    await this.stripeElementsService.resolveActiveOneTimePriceCatalog(
                        context.stripeProductId,
                        priceCatalogId,
                    );

                charge = {
                    amountCents: price.unitAmount,
                    currency: (
                        price.currency || STRIPE_ELEMENTS_DEFAULTS.CURRENCY
                    ).toLowerCase(),
                    productName: context.assessmentDisplayName,
                    priceCatalogId: price._id,
                };
                orderAssessmentId = context.orderAssessmentId;
                assessmentKind = context.assessmentKind;
                resolvedItemType =
                    resolvedItemType || STRIPE_ELEMENTS_ITEM_TYPES.ASSESSMENT;
                resolvedItemId =
                    resolvedItemId || String(context.orderAssessmentId);
            } else {
                charge =
                    await this.stripeElementsService.resolveGenericChargeAmount(
                        { priceCatalogId, amount, currency, productName },
                    );
            }

            const customerId =
                await this.stripeElementsService.getOrCreatePaymentCustomer(
                    user,
                );

            const order = await this.stripeElementsService.createOrder({
                userId: user._id,
                assessmentId: orderAssessmentId || undefined,
                priceCatalogId: charge.priceCatalogId,
                itemType: resolvedItemType,
                itemId: resolvedItemId,
                productName: charge.productName,
                description: description || null,
                currency: charge.currency,
                unitAmount: charge.amountCents,
                status: ORDER_STATUSES.REQUIRES_PAYMENT_METHOD,
                stripeCustomerId: customerId,
            });

            const buildMetadata = (flow) =>
                this.stripeElementsService.withUtmMetadata(
                    {
                        orderId: String(order._id),
                        userId: String(user._id),
                        assessmentId: orderAssessmentId
                            ? String(orderAssessmentId)
                            : "",
                        assessmentKind: assessmentKind || "",
                        itemType: resolvedItemType || "",
                        itemId: resolvedItemId || "",
                        priceCatalogId: charge.priceCatalogId
                            ? String(charge.priceCatalogId)
                            : "",
                        flow,
                    },
                    user,
                );

            const chargeDescription = description || charge.productName;
            const savedPaymentMethodId =
                paymentMethodId || user.defaultPaymentMethodId;

            if (savedPaymentMethodId) {
                try {
                    const paymentIntent =
                        await this.stripeElementsService.createGenericPaymentIntent(
                            {
                                customerId,
                                charge,
                                description: chargeDescription,
                                metadata: buildMetadata(
                                    STRIPE_ELEMENTS_FLOWS.GENERIC_ONE_CLICK,
                                ),
                                paymentMethodId: savedPaymentMethodId,
                            },
                        );

                    await this.stripeElementsService.saveOrderPaymentIntent(
                        order,
                        paymentIntent.id,
                        STRIPE_ELEMENTS_GENERIC_ORDER_STATUS_BY_PAYMENT_INTENT[
                            paymentIntent.status
                        ] || ORDER_STATUSES.PROCESSING,
                    );

                    if (
                        paymentIntent.status ===
                        STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.SUCCEEDED
                    ) {
                        return sendResponse(res, {
                            statusCode: 200,
                            status: RESPONSE_STATUS.SUCCESS,
                            message:
                                STRIPE_ELEMENTS_MESSAGES.PAYMENT_SUCCESSFUL,
                            data: {
                                outcome: STRIPE_ELEMENTS_PAY_OUTCOMES.PAID,
                                orderId: order._id.toString(),
                                paymentIntentId: paymentIntent.id,
                                status: ORDER_STATUSES.SUCCEEDED,
                                amount: charge.amountCents,
                                currency: charge.currency,
                            },
                        });
                    }

                    if (
                        paymentIntent.status ===
                        STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION
                    ) {
                        return sendResponse(res, {
                            statusCode: 200,
                            status: STRIPE_ELEMENTS_RESPONSE_STATUS.REQUIRES_ACTION,
                            message: STRIPE_ELEMENTS_MESSAGES.THREE_DS_REQUIRED,
                            data: {
                                outcome:
                                    STRIPE_ELEMENTS_PAY_OUTCOMES.REQUIRES_ACTION,
                                requiresAction: true,
                                orderId: order._id.toString(),
                                paymentIntentId: paymentIntent.id,
                                clientSecret: paymentIntent.client_secret,
                                paymentMethodId: savedPaymentMethodId,
                            },
                        });
                    }

                    return sendResponse(res, {
                        statusCode: 200,
                        status: STRIPE_ELEMENTS_RESPONSE_STATUS.PENDING,
                        message:
                            STRIPE_ELEMENTS_DYNAMIC_MESSAGES.paymentOutcome(
                                paymentIntent.status,
                            ),
                        data: {
                            outcome: STRIPE_ELEMENTS_PAY_OUTCOMES.PROCESSING,
                            orderId: order._id.toString(),
                            paymentIntentId: paymentIntent.id,
                            status: order.status,
                        },
                    });
                } catch (error) {
                    const failedIntent =
                        error?.raw?.payment_intent || error?.payment_intent;
                    const code = error?.code || error?.raw?.code;
                    const needsAuthentication =
                        failedIntent &&
                        (code ===
                            STRIPE_ELEMENTS_ERROR_CODES.AUTHENTICATION_REQUIRED ||
                            failedIntent.status ===
                                STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION);

                    if (needsAuthentication) {
                        await this.stripeElementsService.saveOrderPaymentIntent(
                            order,
                            failedIntent.id,
                            ORDER_STATUSES.REQUIRES_ACTION,
                        );

                        return sendResponse(res, {
                            statusCode: 200,
                            status: STRIPE_ELEMENTS_RESPONSE_STATUS.REQUIRES_ACTION,
                            message: STRIPE_ELEMENTS_MESSAGES.THREE_DS_REQUIRED,
                            data: {
                                outcome:
                                    STRIPE_ELEMENTS_PAY_OUTCOMES.REQUIRES_ACTION,
                                requiresAction: true,
                                orderId: order._id.toString(),
                                paymentIntentId: failedIntent.id,
                                clientSecret: failedIntent.client_secret,
                                paymentMethodId: savedPaymentMethodId,
                            },
                        });
                    }

                    this.logger.warn(
                        "One click charge failed, collecting a card instead",
                        {
                            requestId: req.requestId,
                            userId: String(user._id),
                            orderId: String(order._id),
                            reason: error.code || error.message,
                        },
                    );
                }
            }

            const collectIntent =
                await this.stripeElementsService.createGenericPaymentIntent({
                    customerId,
                    charge,
                    description: chargeDescription,
                    metadata: buildMetadata(
                        STRIPE_ELEMENTS_FLOWS.GENERIC_COLLECT,
                    ),
                });

            await this.stripeElementsService.saveOrderPaymentIntent(
                order,
                collectIntent.id,
                ORDER_STATUSES.REQUIRES_PAYMENT_METHOD,
            );

            this.logger.info("Card collection payment intent created", {
                requestId: req.requestId,
                userId: String(user._id),
                orderId: String(order._id),
                paymentIntentId: collectIntent.id,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.COLLECT_PAYMENT_METHOD,
                data: {
                    outcome:
                        STRIPE_ELEMENTS_PAY_OUTCOMES.COLLECT_PAYMENT_METHOD,
                    requiresPaymentMethod: true,
                    orderId: order._id.toString(),
                    paymentIntentId: collectIntent.id,
                    clientSecret: collectIntent.client_secret,
                    amount: charge.amountCents,
                    currency: charge.currency,
                },
            });
        } catch (error) {
            this.logger.error("One click payment failed", {
                requestId: req.requestId,
                userId: String(user._id),
                reason: error.message,
            });

            return next(
                httpErrorFrom(error, STRIPE_ELEMENTS_MESSAGES.PAYMENT_FAILED),
            );
        }
    }

    async listPaymentMethods(req, res, next) {
        const user = req.user;

        if (!this.ensureStripe(req, next)) {
            return;
        }

        try {
            const paymentMethods =
                await this.stripeElementsService.listPaymentMethods(user);

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.PAYMENT_METHODS_RETRIEVED,
                data: { paymentMethods },
            });
        } catch (error) {
            next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.PAYMENT_METHODS_FAILED,
                ),
            );
        }
    }

    async createCardSetupIntent(req, res, next) {
        const user = req.user;

        this.logger.info("Request to create a card setup intent", {
            requestId: req.requestId,
            userId: String(user._id),
        });

        if (!this.ensureStripe(req, next)) {
            return;
        }

        try {
            const customerId =
                await this.stripeElementsService.ensureSubscriptionCustomer(
                    user,
                );
            const setupIntent =
                await this.stripeElementsService.createCardSetupIntent(
                    user,
                    customerId,
                );

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.CARD_SETUP_INTENT_CREATED,
                data: {
                    clientSecret: setupIntent.client_secret,
                    setupIntentId: setupIntent.id,
                },
            });
        } catch (error) {
            next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_FAILED,
                ),
            );
        }
    }

    async confirmCardSetup(req, res, next) {
        const user = req.user;
        const { setupIntentId } = req.body;

        if (!this.ensureStripe(req, next)) {
            return;
        }

        if (!setupIntentId) {
            return next(
                createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_ID_REQUIRED,
                ),
            );
        }

        try {
            const setupIntent =
                await this.stripeElementsService.retrieveSetupIntent(
                    setupIntentId,
                );

            if (setupIntent.status !== "succeeded") {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_DYNAMIC_MESSAGES.setupIntentNotConfirmed(
                        setupIntent.status,
                    ),
                );
            }

            if (
                user.stripeCustomerId &&
                setupIntent.customer !== user.stripeCustomerId
            ) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_NOT_OWNED,
                );
            }

            const paymentMethodId = setupIntent.payment_method;

            if (!paymentMethodId) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.SETUP_INTENT_NO_PAYMENT_METHOD,
                );
            }

            if (!user.defaultPaymentMethodId) {
                await this.stripeElementsService.saveDefaultPaymentMethod(
                    user,
                    setupIntent.customer,
                    paymentMethodId,
                );
            }

            const paymentMethods =
                await this.stripeElementsService.listPaymentMethods(user);

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.CARD_SAVED,
                data: { paymentMethodId, paymentMethods },
            });
        } catch (error) {
            next(
                httpErrorFrom(error, STRIPE_ELEMENTS_MESSAGES.CARD_SAVE_FAILED),
            );
        }
    }

    async removePaymentMethod(req, res, next) {
        const user = req.user;
        const { paymentMethodId } = req.params;

        if (!this.ensureStripe(req, next)) {
            return;
        }

        try {
            const paymentMethod =
                await this.stripeElementsService.retrievePaymentMethod(
                    paymentMethodId,
                );

            if (
                !user.stripeCustomerId ||
                paymentMethod.customer !== user.stripeCustomerId
            ) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.PAYMENT_METHOD_NOT_OWNED,
                );
            }

            await this.stripeElementsService.detachPaymentMethod(
                paymentMethodId,
            );

            if (user.defaultPaymentMethodId === paymentMethodId) {
                user.defaultPaymentMethodId = null;
                await user.save();
            }

            const paymentMethods =
                await this.stripeElementsService.listPaymentMethods(user);

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.PAYMENT_METHOD_REMOVED,
                data: { paymentMethods },
            });
        } catch (error) {
            next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.PAYMENT_METHOD_REMOVE_FAILED,
                ),
            );
        }
    }

    async setDefaultPaymentMethod(req, res, next) {
        const user = req.user;
        const { paymentMethodId } = req.params;

        if (!this.ensureStripe(req, next)) {
            return;
        }

        try {
            const paymentMethod =
                await this.stripeElementsService.retrievePaymentMethod(
                    paymentMethodId,
                );

            if (
                !user.stripeCustomerId ||
                paymentMethod.customer !== user.stripeCustomerId
            ) {
                throw createHttpError(
                    403,
                    STRIPE_ELEMENTS_MESSAGES.PAYMENT_METHOD_NOT_OWNED,
                );
            }

            await this.stripeElementsService.saveDefaultPaymentMethod(
                user,
                user.stripeCustomerId,
                paymentMethodId,
            );

            const paymentMethods =
                await this.stripeElementsService.listPaymentMethods(user);

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: STRIPE_ELEMENTS_MESSAGES.DEFAULT_PAYMENT_METHOD_SET,
                data: { paymentMethods },
            });
        } catch (error) {
            next(
                httpErrorFrom(
                    error,
                    STRIPE_ELEMENTS_MESSAGES.DEFAULT_PAYMENT_METHOD_FAILED,
                ),
            );
        }
    }
}

module.exports = { StripeElementsController };
