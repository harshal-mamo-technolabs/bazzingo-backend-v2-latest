        const jwt = require("jsonwebtoken");
        const createHttpError = require("http-errors");
        const { config } = require("../../config");
        const { realUtmValue } = require("../../common/utils/utmParams");
        const {
            RESPONSE_STATUS,
            ORDER_STATUSES,
            STRIPE_UTM_METADATA_KEYS,
            STRIPE_PRICE_TYPES,
            STRIPE_PRODUCT_DURATIONS,
            STRIPE_PLAN_PRODUCT_DURATIONS,
            STRIPE_DURATION_INTERVALS,
            STRIPE_SUBSCRIPTION_TYPES,
            STRIPE_CADENCES,
            STRIPE_SUBSCRIPTION_STATUSES,
            STRIPE_ACTIVE_SUBSCRIPTION_STATUSES,
            STRIPE_TRIAL_TRANSITION_STATUSES,
            STRIPE_PAYMENT_INTENT_STATUSES,
            STRIPE_DEFAULT_CURRENCY,
            STRIPE_FREE_TRIAL_DAYS,
            STRIPE_DEFAULT_INTERVAL_COUNT,
            STRIPE_PRICE_ID_PREFIX,
            STRIPE_PRICE_ID_PATTERN,
            STRIPE_PRICE_ID_CANDIDATE_FIELDS,
            STRIPE_ERROR_TYPES,
            STRIPE_ERROR_CODES,
            STRIPE_FLOWS,
            STRIPE_WEBHOOK_ELEMENTS_FLOWS,
            STRIPE_ORDER_SELECT_FIELDS,
            STRIPE_USER_SELECT_FIELDS,
            STRIPE_USER_SUBSCRIPTION_SELECT_FIELDS,
            STRIPE_BILLING_REASONS,
            STRIPE_METADATA_VALUE_MAX,
            STRIPE_CANCELLATION_METADATA_KEYS,
            STRIPE_WEBHOOK_LIMITS,
            STRIPE_WEBHOOK_SESSION_MATCH_WINDOW_SECONDS,
            STRIPE_DUPLICATE_INVOICE_WINDOW_MS,
            STRIPE_SAME_PERIOD_TOLERANCE_MS,
            STRIPE_AMOUNT_DIVISOR,
            STRIPE_TRIAL_DEBUG_PLACEHOLDERS,
            STRIPE_TRIAL_RESPONSE_ACTIONS,
            STRIPE_TRIAL_STEPS,
            STRIPE_TRIAL_REASONS,
            STRIPE_TRIAL_NEXT_STEPS,
            STRIPE_TRIAL_ERRORS,
            STRIPE_SET_PASSWORD_EMAIL,
            STRIPE_MESSAGES,
            STRIPE_MESSAGE_BUILDERS,
        } = require("../../constants");
        const FullAssessment = require("../assessment/fullAssessmentModel");
        const Plan = require("../plan/planModel");
        const PriceCatalog = require("../price-catalog/priceCatalogModel");
        const User = require("../user/userModel");
        const Order = require("./orderModel");
        const Subscription = require("./subscriptionModel");

        // Omitted entirely (no "default" placeholder) when there's no real value —
        // a non-landing-page purchase has nothing real to report, and stamping
        // "default" on every purchase's metadata is just noise.
        const utmMetadataEntry = (key, value) =>
            realUtmValue(value) ? { [key]: String(value) } : {};

        const mergeUtmMetadata = (metadata = {}, user) => ({
            ...utmMetadataEntry(STRIPE_UTM_METADATA_KEYS.SOURCE, user?.utmSource),
            ...utmMetadataEntry(STRIPE_UTM_METADATA_KEYS.CAMPAIGN, user?.utmCampaign),
            ...utmMetadataEntry(STRIPE_UTM_METADATA_KEYS.MEDIUM, user?.utmMedium),
            ...utmMetadataEntry(STRIPE_UTM_METADATA_KEYS.EMAIL, user?.utmEmail),
            ...metadata,
        });

        const isStripePriceId = (value) =>
            typeof value === "string" && value.startsWith(STRIPE_PRICE_ID_PREFIX);

        const extractStripePriceId = (priceDoc) => {
            if (!priceDoc) {
                return null;
            }

            return (
                STRIPE_PRICE_ID_CANDIDATE_FIELDS.map((field) => priceDoc[field])
                    .filter(Boolean)
                    .find(isStripePriceId) || null
            );
        };

        const isMissingPriceError = (error) =>
            error?.type === STRIPE_ERROR_TYPES.INVALID_REQUEST &&
            error?.code === STRIPE_ERROR_CODES.RESOURCE_MISSING &&
            error?.raw?.param === "price";

        const paymentIntentFromError = (error) =>
            error?.raw?.payment_intent || error?.payment_intent;

        const needsThreeDSecure = (error) => {
            const paymentIntent = paymentIntentFromError(error);
            const code = error?.code || error?.raw?.code;

            return Boolean(
                paymentIntent &&
                (code === STRIPE_ERROR_CODES.AUTHENTICATION_REQUIRED ||
                    paymentIntent.status ===
                        STRIPE_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION),
            );
        };

        const paymentMethodId = (paymentMethod) =>
            (typeof paymentMethod === "string" && paymentMethod) ||
            paymentMethod?.id ||
            "";

        const toDateOrNow = (timestamp) => {
            if (!timestamp) {
                return new Date();
            }

            const date = new Date(timestamp * 1000);

            return Number.isNaN(date.getTime()) ? new Date() : date;
        };

        const toDateOrNull = (timestamp) => {
            if (!timestamp) {
                return null;
            }

            const date = new Date(timestamp * 1000);

            return Number.isNaN(date.getTime()) ? null : date;
        };

        const addCadence = (date, cadence) => {
            const next = new Date(date);

            if (cadence === STRIPE_CADENCES.MONTHLY) {
                next.setMonth(next.getMonth() + 1);
            } else if (cadence === STRIPE_CADENCES.YEARLY) {
                next.setFullYear(next.getFullYear() + 1);
            }

            return next;
        };

        const isElementsFlow = (metadata) =>
            STRIPE_WEBHOOK_ELEMENTS_FLOWS.includes(metadata?.flow);

        const parseStayIfOffered = (raw) => {
            if (raw == null || raw === "" || typeof raw !== "string") {
                return [];
            }

            try {
                const parsed = JSON.parse(raw);

                if (Array.isArray(parsed)) {
                    return parsed.filter((entry) => typeof entry === "string");
                }
            } catch {
                return raw
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter(Boolean);
            }

            return raw
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean);
        };

        const validateCancellationSurvey = (body) => {
            const { cancelReason, wouldHaveStayedIfOffered } = body || {};

            if (typeof cancelReason !== "string") {
                throw createHttpError(400, STRIPE_MESSAGES.CANCEL_REASON_NOT_STRING);
            }

            const reason = cancelReason.trim();

            if (!reason) {
                throw createHttpError(400, STRIPE_MESSAGES.CANCEL_REASON_EMPTY);
            }

            if (reason.length > STRIPE_METADATA_VALUE_MAX) {
                throw createHttpError(
                    400,
                    STRIPE_MESSAGE_BUILDERS.cancelReasonTooLong(
                        STRIPE_METADATA_VALUE_MAX,
                    ),
                );
            }

            if (
                !Array.isArray(wouldHaveStayedIfOffered) ||
                wouldHaveStayedIfOffered.length === 0
            ) {
                throw createHttpError(400, STRIPE_MESSAGES.STAY_IF_OFFERED_NOT_ARRAY);
            }

            const items = [];

            for (const entry of wouldHaveStayedIfOffered) {
                if (typeof entry !== "string") {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGES.STAY_IF_OFFERED_NOT_STRINGS,
                    );
                }

                const trimmed = entry.trim();

                if (!trimmed) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGES.STAY_IF_OFFERED_ENTRY_EMPTY,
                    );
                }

                items.push(trimmed);
            }

            const unique = [...new Set(items)];

            if (JSON.stringify(unique).length > STRIPE_METADATA_VALUE_MAX) {
                throw createHttpError(
                    400,
                    STRIPE_MESSAGE_BUILDERS.stayIfOfferedTooLarge(
                        STRIPE_METADATA_VALUE_MAX,
                    ),
                );
            }

            return { cancelReason: reason, wouldHaveStayedIfOffered: unique };
        };

        const buildCancellationMetadata = (cancelReason, wouldHaveStayedIfOffered) => ({
            [STRIPE_CANCELLATION_METADATA_KEYS.CANCEL_REASON]: cancelReason,
            [STRIPE_CANCELLATION_METADATA_KEYS.STAY_IF_OFFERED]: JSON.stringify(
                wouldHaveStayedIfOffered,
            ),
        });

        const buildRequestId = () =>
            `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        class StripeService {
            constructor(logger, stripe, klaviyoSync = null, sendEmail = null) {
                this.logger = logger;
                this.stripe = stripe;
                this.klaviyoSync = klaviyoSync;
                this.sendEmail = sendEmail;
            }

            requireStripe() {
                if (!this.stripe) {
                    this.logger.error("Stripe client is not configured");

                    throw createHttpError(500, STRIPE_MESSAGES.STRIPE_NOT_CONFIGURED);
                }

                return this.stripe;
            }

            syncSubscriptionToKlaviyo(payload) {
                if (!this.klaviyoSync?.syncSubscription) {
                    return;
                }

                this.pendingKlaviyoSync = Promise.resolve(
                    this.klaviyoSync.syncSubscription(payload),
                ).catch((error) => {
                    this.logger.error("Klaviyo subscription sync failed", {
                        reason: error.message,
                    });
                });
            }

            syncAssessmentPurchaseToKlaviyo(payload) {
                if (!this.klaviyoSync?.syncAssessmentPurchase) {
                    return;
                }

                this.pendingKlaviyoSync = Promise.resolve(
                    this.klaviyoSync.syncAssessmentPurchase(payload),
                ).catch((error) => {
                    this.logger.error("Klaviyo assessment purchase sync failed", {
                        reason: error.message,
                    });
                });
            }

            async resolveStripePriceId(reference) {
                if (!reference) {
                    return null;
                }

                if (isStripePriceId(reference)) {
                    return reference;
                }

                const priceDoc = await PriceCatalog.findById(reference).lean();

                if (!priceDoc) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGE_BUILDERS.priceCatalogNotFound(String(reference)),
                    );
                }

                const stripePriceId = extractStripePriceId(priceDoc);

                if (!stripePriceId) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGE_BUILDERS.priceCatalogWithoutStripeId(
                            priceDoc._id,
                        ),
                    );
                }

                return stripePriceId;
            }

            async resolveConfirmStripePriceId(reference) {
                if (!reference) {
                    return null;
                }

                if (isStripePriceId(reference)) {
                    return reference;
                }

                const priceDoc = await PriceCatalog.findById(reference).lean();

                if (!priceDoc) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGE_BUILDERS.priceCatalogNotFound(String(reference)),
                    );
                }

                const stripePriceId = extractStripePriceId(priceDoc);

                if (!stripePriceId) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGE_BUILDERS.priceCatalogWithoutStripeIdShort(
                            priceDoc._id,
                        ),
                    );
                }

                return stripePriceId;
            }

            async resolvePriceParent({ assessmentId, planId, productDuration }) {
                if (assessmentId) {
                    const assessment = await FullAssessment.findById(assessmentId);

                    if (!assessment) {
                        throw createHttpError(
                            404,
                            STRIPE_MESSAGES.ASSESSMENT_NOT_FOUND,
                        );
                    }

                    if (!assessment.stripeProductId) {
                        throw createHttpError(
                            400,
                            STRIPE_MESSAGES.ASSESSMENT_WITHOUT_PRODUCT,
                        );
                    }

                    return {
                        productId: assessment.stripeProductId,
                        type: STRIPE_PRICE_TYPES.ONE_TIME,
                        resolvedProductDuration: STRIPE_PRODUCT_DURATIONS.ONETIME,
                        parentFilter: { assessmentId },
                    };
                }

                const plan = await Plan.findById(planId);

                if (!plan) {
                    throw createHttpError(404, STRIPE_MESSAGES.PLAN_NOT_FOUND);
                }

                if (!plan.stripeProductId) {
                    throw createHttpError(400, STRIPE_MESSAGES.PLAN_WITHOUT_PRODUCT);
                }

                if (
                    !productDuration ||
                    !STRIPE_PLAN_PRODUCT_DURATIONS.includes(productDuration)
                ) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGES.PRODUCT_DURATION_INVALID,
                    );
                }

                return {
                    productId: plan.stripeProductId,
                    type: STRIPE_PRICE_TYPES.RECURRING,
                    resolvedProductDuration: productDuration,
                    parentFilter: { planId },
                };
            }

            async createPrice({
                assessmentId,
                planId,
                unitAmount,
                currency = STRIPE_DEFAULT_CURRENCY,
                productDuration,
                intervalCount = STRIPE_DEFAULT_INTERVAL_COUNT,
                metadata = {},
                lookupKey,
            }) {
                this.logger.info("Creating a stripe price", {
                    assessmentId,
                    planId,
                    unitAmount,
                });

                const { productId, type, resolvedProductDuration, parentFilter } =
                    await this.resolvePriceParent({
                        assessmentId,
                        planId,
                        productDuration,
                    });

                const recurringParams = assessmentId
                    ? undefined
                    : {
                        interval: STRIPE_DURATION_INTERVALS[productDuration],
                        interval_count: Math.max(
                            parseInt(intervalCount, 10) ||
                                STRIPE_DEFAULT_INTERVAL_COUNT,
                            STRIPE_DEFAULT_INTERVAL_COUNT,
                        ),
                    };

                try {
                    this.requireStripe();

                    const priceCreateParams = {
                        product: productId,
                        unit_amount: unitAmount,
                        currency: currency.toLowerCase(),
                        metadata: {
                            ...(assessmentId ? { assessmentId } : { planId }),
                            ...metadata,
                        },
                    };

                    if (lookupKey) {
                        priceCreateParams.lookup_key = lookupKey;
                    }

                    if (recurringParams) {
                        priceCreateParams.recurring = recurringParams;
                    }

                    const stripePrice =
                        await this.stripe.prices.create(priceCreateParams);

                    const priceDoc = await PriceCatalog.create({
                        ...(assessmentId ? { assessmentId } : { planId }),
                        stripePriceId: stripePrice.id,
                        stripeProductId: productId,
                        type,
                        currency: currency.toUpperCase(),
                        unitAmount,
                        metadata: new Map(Object.entries(metadata || {})),
                        productDuration: resolvedProductDuration,
                        active: true,
                        default: true,
                        ...(lookupKey ? { lookupKey } : {}),
                    });

                    await PriceCatalog.updateMany(
                        {
                            ...parentFilter,
                            _id: { $ne: priceDoc._id },
                            default: true,
                            ...(assessmentId
                                ? {}
                                : { productDuration: resolvedProductDuration }),
                        },
                        { $set: { default: false } },
                    );

                    this.logger.info("Stripe price created", {
                        priceId: String(priceDoc._id),
                        stripePriceId: stripePrice.id,
                    });

                    return { price: priceDoc, stripePriceId: stripePrice.id };
                } catch (error) {
                    this.logger.error("Stripe price creation failed", {
                        assessmentId,
                        planId,
                        reason: error.message,
                    });

                    throw createHttpError(
                        error.statusCode || error.status || 500,
                        error.message || STRIPE_MESSAGES.PRICE_CREATE_FAILED,
                    );
                }
            }

            async findAssessmentPrice(assessmentId) {
                const defaultPrice = await PriceCatalog.findOne({
                    assessmentId,
                    type: STRIPE_PRICE_TYPES.ONE_TIME,
                    active: true,
                    default: true,
                }).lean();

                if (defaultPrice) {
                    return defaultPrice;
                }

                return await PriceCatalog.findOne({
                    assessmentId,
                    type: STRIPE_PRICE_TYPES.ONE_TIME,
                    active: true,
                })
                    .sort({ createdAt: -1 })
                    .lean();
            }

            async ensureStripeCustomer(user, source) {
                if (user.stripeCustomerId) {
                    return user.stripeCustomerId;
                }

                const customer = await this.stripe.customers.create({
                    email: user.email,
                    name: user.name || undefined,
                    metadata: mergeUtmMetadata(
                        { userId: user._id.toString(), source },
                        user,
                    ),
                });

                user.stripeCustomerId = customer.id;
                await user.save();

                this.logger.info("Stripe customer created", {
                    userId: String(user._id),
                    stripeCustomerId: customer.id,
                });

                return customer.id;
            }

            async createCheckoutOrOneClick({
                user,
                assessmentId,
                successUrl,
                cancelUrl,
            }) {
                this.logger.info("Creating a checkout session for an assessment", {
                    userId: String(user._id),
                    assessmentId,
                });

                this.requireStripe();

                const assessment = await FullAssessment.findById(assessmentId).lean();

                if (!assessment) {
                    throw createHttpError(404, STRIPE_MESSAGES.ASSESSMENT_NOT_FOUND);
                }

                const price = await this.findAssessmentPrice(assessment._id);

                if (!price) {
                    throw createHttpError(404, STRIPE_MESSAGES.NO_ONE_TIME_PRICE);
                }

                await this.ensureStripeCustomer(user, STRIPE_FLOWS.CHECKOUT_CUSTOMER);

                const order = await Order.create({
                    userId: user._id,
                    assessmentId: assessment._id,
                    priceCatalogId: price._id,
                    currency: price.currency,
                    unitAmount: price.unitAmount,
                    status: ORDER_STATUSES.REQUIRES_PAYMENT_METHOD,
                    stripeCustomerId: user.stripeCustomerId,
                });

                if (user.stripeCustomerId && user.defaultPaymentMethodId) {
                    const oneClick = await this.tryOneClickPayment({
                        user,
                        order,
                        price,
                        assessment,
                    });

                    if (oneClick) {
                        return oneClick;
                    }
                }

                let session;

                try {
                    session = await this.stripe.checkout.sessions.create({
                        mode: "payment",
                        payment_method_types: ["card"],
                        line_items: [{ price: price.stripePriceId, quantity: 1 }],
                        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
                        cancel_url: cancelUrl,
                        allow_promotion_codes: true,
                        automatic_tax: { enabled: false },
                        customer: user.stripeCustomerId,
                        payment_intent_data: {
                            setup_future_usage: "off_session",
                            metadata: mergeUtmMetadata(
                                {
                                    orderId: String(order._id),
                                    userId: String(user._id),
                                    assessmentId: String(assessment._id),
                                    priceCatalogId: String(price._id),
                                    flow: STRIPE_FLOWS.CHECKOUT,
                                },
                                user,
                            ),
                        },
                        payment_method_options: {
                            card: { request_three_d_secure: "automatic" },
                        },
                        client_reference_id: String(order._id),
                        metadata: mergeUtmMetadata(
                            {
                                orderId: String(order._id),
                                userId: String(user._id),
                                assessmentId: String(assessment._id),
                                priceCatalogId: String(price._id),
                                flow: STRIPE_FLOWS.CHECKOUT,
                            },
                            user,
                        ),
                    });
                } catch (error) {
                    this.logger.error("Stripe checkout session creation failed", {
                        userId: String(user._id),
                        orderId: String(order._id),
                        reason: error.message,
                    });

                    if (isMissingPriceError(error)) {
                        throw createHttpError(
                            404,
                            STRIPE_MESSAGE_BUILDERS.checkoutPriceMissing(
                                price.stripePriceId,
                            ),
                        );
                    }

                    throw createHttpError(
                        error.statusCode || error.status || 500,
                        error.message || STRIPE_MESSAGES.CHECKOUT_SESSION_FAILED,
                    );
                }

                order.status = ORDER_STATUSES.REQUIRES_PAYMENT_METHOD;
                order.stripeSessionId = session.id;
                order.stripeCustomerId =
                    session.customer || order.stripeCustomerId || null;
                await order.save();

                this.logger.info("Stripe checkout session created", {
                    userId: String(user._id),
                    orderId: String(order._id),
                    sessionId: session.id,
                });

                return { kind: "checkout", session, order };
            }

            async tryOneClickPayment({ user, order, price, assessment }) {
                try {
                    const paymentIntent = await this.stripe.paymentIntents.create({
                        amount: price.unitAmount,
                        currency: price.currency.toLowerCase(),
                        customer: user.stripeCustomerId,
                        payment_method: user.defaultPaymentMethodId,
                        confirm: true,
                        off_session: true,
                        description:
                            STRIPE_MESSAGE_BUILDERS.assessmentPurchaseDescription(
                                assessment.mainCategory,
                            ),
                        metadata: mergeUtmMetadata(
                            {
                                orderId: String(order._id),
                                userId: String(user._id),
                                assessmentId: String(assessment._id),
                                priceCatalogId: String(price._id),
                                flow: STRIPE_FLOWS.ONE_CLICK,
                            },
                            user,
                        ),
                        automatic_payment_methods: {
                            enabled: true,
                            allow_redirects: "never",
                        },
                    });

                    order.status =
                        paymentIntent.status ===
                        STRIPE_PAYMENT_INTENT_STATUSES.SUCCEEDED
                            ? ORDER_STATUSES.SUCCEEDED
                            : ORDER_STATUSES.PROCESSING;
                    order.stripePaymentIntentId = paymentIntent.id;
                    await order.save();

                    this.logger.info("One click payment initiated", {
                        userId: String(user._id),
                        orderId: String(order._id),
                        paymentIntentId: paymentIntent.id,
                    });

                    return { kind: "one_click", order, paymentIntent };
                } catch (error) {
                    this.logger.warn("One click payment failed", {
                        userId: String(user._id),
                        orderId: String(order._id),
                        reason: error.message,
                    });

                    if (!needsThreeDSecure(error)) {
                        return null;
                    }

                    const paymentIntent = paymentIntentFromError(error);

                    order.status = ORDER_STATUSES.REQUIRES_ACTION;
                    order.stripePaymentIntentId = paymentIntent.id;
                    await order.save();

                    let resolvedPaymentMethodId = paymentMethodId(
                        paymentIntent.payment_method,
                    );

                    if (!resolvedPaymentMethodId) {
                        try {
                            const freshPaymentIntent =
                                await this.stripe.paymentIntents.retrieve(
                                    paymentIntent.id,
                                );

                            resolvedPaymentMethodId = paymentMethodId(
                                freshPaymentIntent.payment_method,
                            );
                        } catch {
                            resolvedPaymentMethodId = "";
                        }
                    }

                    if (!resolvedPaymentMethodId && user.defaultPaymentMethodId) {
                        resolvedPaymentMethodId = user.defaultPaymentMethodId;
                    }

                    return {
                        kind: "requires_action",
                        order,
                        paymentIntent,
                        paymentMethodId: resolvedPaymentMethodId || undefined,
                    };
                }
            }

            resolveSubscriptionPrices(plan, type) {
                if (type === STRIPE_SUBSCRIPTION_TYPES.TRIAL) {
                    const trialPriceRef = plan.prices?.trial || null;

                    if (plan.prices?.monthly?.priceId) {
                        return {
                            trialPriceRef,
                            recurringPriceRef: plan.prices.monthly.priceId,
                            recurringCadence: STRIPE_CADENCES.MONTHLY,
                        };
                    }

                    if (plan.prices?.yearly?.priceId) {
                        return {
                            trialPriceRef,
                            recurringPriceRef: plan.prices.yearly.priceId,
                            recurringCadence: STRIPE_CADENCES.YEARLY,
                        };
                    }

                    throw createHttpError(
                        400,
                        STRIPE_MESSAGES.PLAN_WITHOUT_RECURRING_PRICE,
                    );
                }

                const priceConfig = plan.prices?.[type];

                if (!priceConfig?.priceId) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGE_BUILDERS.planPriceNotConfigured(type),
                    );
                }

                return {
                    trialPriceRef: null,
                    recurringPriceRef: priceConfig.priceId,
                    recurringCadence: type,
                };
            }

            async createSubscription({ user, planId, type, successUrl, cancelUrl }) {
                this.logger.info("Creating a subscription", {
                    userId: String(user?._id),
                    planId,
                    type,
                });

                this.requireStripe();

                if (!user) {
                    throw createHttpError(404, STRIPE_MESSAGES.USER_NOT_FOUND);
                }

                const plan = await Plan.findById(planId).lean();

                if (!plan) {
                    throw createHttpError(404, STRIPE_MESSAGES.PLAN_NOT_FOUND);
                }

                const { trialPriceRef, recurringPriceRef, recurringCadence } =
                    this.resolveSubscriptionPrices(plan, type);

                const recurringPriceId =
                    await this.resolveStripePriceId(recurringPriceRef);
                const trialPriceId = trialPriceRef
                    ? await this.resolveStripePriceId(trialPriceRef)
                    : null;

                const pricePromises = [this.stripe.prices.retrieve(recurringPriceId)];

                if (trialPriceId) {
                    pricePromises.push(this.stripe.prices.retrieve(trialPriceId));
                }

                const [recurringPrice, trialPrice] = await Promise.all(pricePromises);

                if (!recurringPrice?.active) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGES.RECURRING_PRICE_INACTIVE,
                    );
                }

                if (trialPrice && !trialPrice?.active) {
                    throw createHttpError(400, STRIPE_MESSAGES.TRIAL_PRICE_INACTIVE);
                }

                if (recurringPrice.type !== STRIPE_PRICE_TYPES.RECURRING) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGES.RECURRING_PRICE_NOT_RECURRING,
                    );
                }

                if (trialPrice && trialPrice.type !== STRIPE_PRICE_TYPES.ONE_TIME) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGES.TRIAL_PRICE_NOT_ONE_TIME,
                    );
                }

                const recurringCurrency = (recurringPrice.currency || "").toLowerCase();

                if (trialPrice) {
                    const trialCurrency = (trialPrice.currency || "").toLowerCase();

                    if (!recurringCurrency || recurringCurrency !== trialCurrency) {
                        throw createHttpError(400, STRIPE_MESSAGES.CURRENCY_MISMATCH);
                    }
                }

                const lineItems = [{ price: recurringPriceId, quantity: 1 }];

                if (trialPriceId) {
                    lineItems.push({ price: trialPriceId, quantity: 1 });
                }

                const trialRequested = type === STRIPE_SUBSCRIPTION_TYPES.TRIAL;
                const trialHonored = trialRequested && Boolean(trialPriceId);
                const freeTrialDays = trialHonored ? STRIPE_FREE_TRIAL_DAYS : undefined;
                const flowTag = trialHonored
                    ? STRIPE_FLOWS.PAID_TRIAL_CHECKOUT
                    : STRIPE_FLOWS.SUBSCRIPTION_CHECKOUT;

                const planInfo = {
                    id: plan._id,
                    name: plan.name,
                    type,
                    recurringCadence,
                    paidTrial: Boolean(trialPriceId),
                    freeTrialDays: freeTrialDays ?? 0,
                    trialRequested,
                    trialHonored,
                };

                const sharedMetadata = {
                    ...(user._id ? { userId: String(user._id) } : {}),
                    planId: String(planId),
                    subscriptionType: type,
                    recurringCadence,
                    trialRequested: String(trialRequested),
                    trialHonored: String(trialHonored),
                    freeTrialDays: String(freeTrialDays ?? 0),
                    flow: flowTag,
                };

                const params = {
                    mode: "subscription",
                    payment_method_types: ["card"],
                    payment_method_collection: "always",
                    line_items: lineItems,
                    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: cancelUrl,
                    allow_promotion_codes: true,
                    automatic_tax: { enabled: false },
                    subscription_data: {
                        ...(freeTrialDays !== undefined
                            ? { trial_period_days: freeTrialDays }
                            : {}),
                        metadata: mergeUtmMetadata(sharedMetadata, user),
                    },
                    payment_method_options: {
                        card: { request_three_d_secure: "automatic" },
                    },
                    metadata: mergeUtmMetadata(sharedMetadata, user),
                };

                await this.ensureStripeCustomer(
                    user,
                    STRIPE_FLOWS.SUBSCRIPTION_CUSTOMER,
                );

                if (user.stripeCustomerId) {
                    params.customer = user.stripeCustomerId;
                } else {
                    params.customer_creation = "always";

                    if (user.email) {
                        params.customer_email = user.email;
                    }
                }

                if (user.stripeCustomerId && user.defaultPaymentMethodId) {
                    const oneClick = await this.tryOneClickSubscription({
                        user,
                        plan,
                        planId,
                        type,
                        recurringPriceId,
                        recurringPrice,
                        trialPrice,
                        recurringCadence,
                        trialRequested,
                        trialHonored,
                        freeTrialDays,
                        planInfo,
                    });

                    if (oneClick) {
                        return oneClick;
                    }
                }

                let session;

                try {
                    session = await this.stripe.checkout.sessions.create(params);
                } catch (error) {
                    this.logger.error("Subscription checkout session failed", {
                        userId: String(user._id),
                        planId,
                        reason: error.message,
                    });

                    if (isMissingPriceError(error)) {
                        throw createHttpError(
                            404,
                            STRIPE_MESSAGE_BUILDERS.subscriptionPricesMissing(
                                [recurringPriceId, trialPriceId]
                                    .filter(Boolean)
                                    .join(", "),
                            ),
                        );
                    }

                    throw createHttpError(
                        error.statusCode || error.status || 500,
                        error.message || STRIPE_MESSAGES.CHECKOUT_SESSION_FAILED,
                    );
                }

                this.logger.info("Subscription checkout session created", {
                    userId: String(user._id),
                    planId,
                    sessionId: session.id,
                });

                return { kind: "checkout", session, planInfo };
            }

            async tryOneClickSubscription({
                user,
                plan,
                planId,
                type,
                recurringPriceId,
                recurringPrice,
                trialPrice,
                recurringCadence,
                trialRequested,
                trialHonored,
                freeTrialDays,
                planInfo,
            }) {
                try {
                    const paymentIntent = await this.stripe.paymentIntents.create({
                        amount: trialHonored
                            ? trialPrice.unit_amount
                            : recurringPrice.unit_amount,
                        currency: recurringPrice.currency,
                        customer: user.stripeCustomerId,
                        payment_method: user.defaultPaymentMethodId,
                        confirmation_method: "automatic",
                        confirm: true,
                        off_session: true,
                        description: STRIPE_MESSAGE_BUILDERS.subscriptionDescription(
                            plan.name,
                            recurringCadence,
                        ),
                        metadata: mergeUtmMetadata(
                            {
                                userId: String(user._id),
                                planId: String(planId),
                                subscriptionType: type,
                                recurringCadence,
                                trialRequested: String(trialRequested),
                                trialHonored: String(trialHonored),
                                freeTrialDays: String(freeTrialDays ?? 0),
                                flow: STRIPE_FLOWS.ONE_CLICK_SUBSCRIPTION_MANUAL_PI,
                            },
                            user,
                        ),
                    });

                    if (
                        paymentIntent.status ===
                        STRIPE_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION
                    ) {
                        return {
                            kind: "requires_action",
                            paymentIntent,
                            paymentMethodId:
                                paymentMethodId(paymentIntent.payment_method) ||
                                user.defaultPaymentMethodId,
                            planInfo,
                        };
                    }

                    if (
                        paymentIntent.status !==
                        STRIPE_PAYMENT_INTENT_STATUSES.SUCCEEDED
                    ) {
                        throw new Error(
                            STRIPE_MESSAGE_BUILDERS.unexpectedPaymentIntentStatus(
                                paymentIntent.status,
                            ),
                        );
                    }

                    const subscriptionParams = {
                        customer: user.stripeCustomerId,
                        items: [{ price: recurringPriceId, quantity: 1 }],
                        default_payment_method: user.defaultPaymentMethodId,
                        metadata: mergeUtmMetadata(
                            {
                                userId: String(user._id),
                                planId: String(planId),
                                subscriptionType: type,
                                recurringCadence,
                                trialRequested: String(trialRequested),
                                trialHonored: String(trialHonored),
                                freeTrialDays: String(freeTrialDays ?? 0),
                                flow: STRIPE_FLOWS.ONE_CLICK_SUBSCRIPTION_AFTER_PI,
                                paymentIntentId: paymentIntent.id,
                                firstPaymentCompleted: "true",
                            },
                            user,
                        ),
                    };

                    if (trialHonored) {
                        subscriptionParams.trial_period_days = freeTrialDays;
                    } else {
                        subscriptionParams.billing_cycle_anchor = Math.floor(
                            addCadence(new Date(), recurringCadence).getTime() / 1000,
                        );
                        subscriptionParams.proration_behavior = "none";
                    }

                    const stripeSubscription =
                        await this.stripe.subscriptions.create(subscriptionParams);

                    this.logger.info("Subscription created with a saved card", {
                        userId: String(user._id),
                        subscriptionId: stripeSubscription.id,
                    });

                    return {
                        kind: "created",
                        stripeSubscription,
                        paymentIntent,
                        planInfo,
                        paymentMethodId: user.defaultPaymentMethodId,
                    };
                } catch (error) {
                    this.logger.warn("One click subscription failed", {
                        userId: String(user._id),
                        planId: String(planId),
                        reason: error.message,
                    });

                    if (isMissingPriceError(error)) {
                        throw createHttpError(
                            404,
                            STRIPE_MESSAGE_BUILDERS.subscriptionPriceMissing(
                                recurringPriceId,
                            ),
                        );
                    }

                    if (!needsThreeDSecure(error)) {
                        return null;
                    }

                    const paymentIntent = paymentIntentFromError(error);

                    return {
                        kind: "requires_action",
                        paymentIntent,
                        paymentMethodId:
                            paymentMethodId(paymentIntent.payment_method) ||
                            user.defaultPaymentMethodId,
                        planInfo,
                    };
                }
            }

            async confirmSubscription({ user, paymentIntentId, planId, type }) {
                this.logger.info("Confirming a subscription after authentication", {
                    userId: String(user._id),
                    planId,
                    type,
                });

                const plan = await Plan.findById(planId).lean();

                if (!plan) {
                    throw createHttpError(404, STRIPE_MESSAGES.PLAN_NOT_FOUND);
                }

                try {
                    const paymentIntent =
                        await this.stripe.paymentIntents.retrieve(paymentIntentId);

                    if (
                        paymentIntent.status ===
                        STRIPE_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION
                    ) {
                        return { kind: "requires_action", paymentIntent };
                    }

                    if (
                        paymentIntent.status !==
                        STRIPE_PAYMENT_INTENT_STATUSES.SUCCEEDED
                    ) {
                        return { kind: "not_succeeded", paymentIntent };
                    }

                    const metadata = paymentIntent.metadata || {};
                    const recurringCadence = metadata.recurringCadence || type;
                    const trialRequested = metadata.trialRequested === "true";
                    const trialHonored = metadata.trialHonored === "true";
                    const freeTrialDays = parseInt(metadata.freeTrialDays, 10) || 0;

                    let recurringPriceRef = null;

                    if (type === STRIPE_SUBSCRIPTION_TYPES.TRIAL) {
                        if (plan.prices?.monthly?.priceId) {
                            recurringPriceRef = plan.prices.monthly.priceId;
                        } else if (plan.prices?.yearly?.priceId) {
                            recurringPriceRef = plan.prices.yearly.priceId;
                        }
                    } else {
                        const priceConfig = plan.prices?.[type];

                        if (!priceConfig?.priceId) {
                            throw createHttpError(
                                400,
                                STRIPE_MESSAGE_BUILDERS.planPriceNotConfigured(type),
                            );
                        }

                        recurringPriceRef = priceConfig.priceId;
                    }

                    const recurringPriceId =
                        await this.resolveConfirmStripePriceId(recurringPriceRef);

                    const subscriptionParams = {
                        customer: user.stripeCustomerId,
                        items: [{ price: recurringPriceId, quantity: 1 }],
                        default_payment_method: user.defaultPaymentMethodId,
                        metadata: mergeUtmMetadata(
                            {
                                userId: String(user._id),
                                planId: String(planId),
                                subscriptionType: type,
                                recurringCadence,
                                trialRequested: String(trialRequested),
                                trialHonored: String(trialHonored),
                                freeTrialDays: String(freeTrialDays),
                                flow: STRIPE_FLOWS.CONFIRMED_AFTER_3DS,
                                paymentIntentId: paymentIntent.id,
                                firstPaymentCompleted: "true",
                            },
                            user,
                        ),
                    };

                    if (trialHonored && freeTrialDays > 0) {
                        subscriptionParams.trial_period_days = freeTrialDays;
                    } else {
                        subscriptionParams.billing_cycle_anchor = Math.floor(
                            addCadence(new Date(), recurringCadence).getTime() / 1000,
                        );
                        subscriptionParams.proration_behavior = "none";
                    }

                    const stripeSubscription =
                        await this.stripe.subscriptions.create(subscriptionParams);

                    this.logger.info("Subscription confirmed after authentication", {
                        userId: String(user._id),
                        subscriptionId: stripeSubscription.id,
                    });

                    return {
                        kind: "created",
                        stripeSubscription,
                        paymentIntent,
                        planInfo: {
                            id: plan._id,
                            name: plan.name,
                            type,
                            recurringCadence,
                            paidTrial: Boolean(metadata.trialPriceId),
                            freeTrialDays,
                            trialRequested,
                            trialHonored,
                        },
                    };
                } catch (error) {
                    this.logger.error("Subscription confirmation failed", {
                        userId: String(user._id),
                        planId,
                        reason: error.message,
                    });

                    if (createHttpError.isHttpError(error)) {
                        throw error;
                    }

                    if (isMissingPriceError(error)) {
                        throw createHttpError(
                            404,
                            STRIPE_MESSAGE_BUILDERS.subscriptionPriceMissing(
                                error.raw?.message?.match(
                                    STRIPE_PRICE_ID_PATTERN,
                                )?.[0] || "unknown",
                            ),
                        );
                    }

                    throw createHttpError(
                        error.statusCode || error.status || 500,
                        error.message || STRIPE_MESSAGES.CONFIRM_SUBSCRIPTION_FAILED,
                    );
                }
            }

            async getSubscriptionStatus(userId) {
                this.logger.info("Reading the subscription status", {
                    userId: String(userId),
                });

                const subscription = await Subscription.findOne({ userId })
                    .populate("priceCatalogId")
                    .lean();

                if (
                    !subscription ||
                    !STRIPE_ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)
                ) {
                    return { hasSubscription: false };
                }

                const plan = await Plan.findById(subscription.planId).lean();

                return {
                    hasSubscription: true,
                    subscription: {
                        status: subscription.status,
                        plan,
                        currentPeriodStart: subscription.currentPeriodStart,
                        currentPeriodEnd: subscription.currentPeriodEnd,
                        nextBillingDate: subscription.nextBillingDate,
                        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                        cancelAt: subscription.cancelAt,
                        trialStart: subscription.trialStart,
                        trialEnd: subscription.trialEnd,
                    },
                };
            }

            async getInvoices(userId) {
                this.logger.info("Reading stripe invoices", {
                    userId: String(userId),
                });

                const user = await User.findById(userId).lean();

                if (!user?.stripeCustomerId) {
                    return { invoices: [] };
                }

                // One-time purchases (assessments, quick-pay) never get a Stripe
                // Invoice — only a Charge — so they're pulled in separately via
                // our own Order records and matched to their Charge for a receipt link.
                const [invoiceList, chargeList, orders] = await Promise.all([
                    this.stripe.invoices.list({
                        customer: user.stripeCustomerId,
                        limit: 100,
                        // Needed to resolve the paying PaymentIntent below, so a
                        // paid invoice can link to its actual charge receipt
                        // instead of the invoice PDF.
                        expand: ["data.payments"],
                    }),
                    this.stripe.charges.list({
                        customer: user.stripeCustomerId,
                        limit: 100,
                    }),
                    Order.find({
                        userId,
                        status: ORDER_STATUSES.SUCCEEDED,
                    }).lean(),
                ]);

                // A payment intent can carry more than one charge (e.g. a declined
                // attempt retried into a success) — charges.list returns them
                // newest-first, so keying the map without filtering lets a later,
                // failed attempt silently overwrite the earlier successful one
                // and drop the receipt (and the whole purchase) from the response.
                const chargeByPaymentIntent = new Map(
                    chargeList.data
                        .filter((charge) => charge.status === "succeeded")
                        .map((charge) => [charge.payment_intent, charge]),
                );

                // Paid: link to the receipt for that charge (falls back to the
                // invoice PDF if no matching charge is found). Unpaid: link to
                // Stripe's hosted invoice page, which lets the customer pay it.
                const subscriptionInvoices = invoiceList.data.map((invoice) => {
                    const paymentIntentId =
                        invoice.payments?.data?.[0]?.payment?.payment_intent;
                    const receiptUrl =
                        chargeByPaymentIntent.get(paymentIntentId)?.receipt_url;
                    const isPaid = invoice.status === "paid";

                    return {
                        id: invoice.id,
                        number: invoice.number,
                        description: null,
                        status: invoice.status,
                        amountPaid: invoice.amount_paid / STRIPE_AMOUNT_DIVISOR,
                        total: invoice.total / STRIPE_AMOUNT_DIVISOR,
                        currency: invoice.currency,
                        created: new Date(invoice.created * 1000),
                        hostedInvoiceUrl: invoice.hosted_invoice_url,
                        invoicePdf: isPaid
                            ? receiptUrl || invoice.invoice_pdf
                            : invoice.invoice_pdf,
                    };
                });

                const oneTimePurchases = orders
                    .map((order) => {
                        const charge = chargeByPaymentIntent.get(
                            order.stripePaymentIntentId,
                        );
                        const receiptUrl = charge?.receipt_url || null;

                        if (!receiptUrl) return null;

                        return {
                            id: String(order._id),
                            number: null,
                            description:
                                order.productName || order.description || null,
                            status: "paid",
                            amountPaid:
                                (charge?.amount ?? order.unitAmount ?? 0) /
                                STRIPE_AMOUNT_DIVISOR,
                            total:
                                (charge?.amount ?? order.unitAmount ?? 0) /
                                STRIPE_AMOUNT_DIVISOR,
                            currency: (
                                charge?.currency ||
                                order.currency ||
                                STRIPE_DEFAULT_CURRENCY
                            ).toLowerCase(),
                            created: order.createdAt,
                            hostedInvoiceUrl: receiptUrl,
                            invoicePdf: receiptUrl,
                        };
                    })
                    .filter(Boolean);

                const invoices = [...subscriptionInvoices, ...oneTimePurchases].sort(
                    (a, b) => new Date(b.created) - new Date(a.created),
                );

                return { invoices };
            }

            async checkSessionPresence(stripeSessionId) {
                this.logger.info("Checking a stripe session presence", {
                    stripeSessionId,
                });

                try {
                    const [orderDoc, subscriptionDoc] = await Promise.all([
                        Order.findOne({ stripeSessionId })
                            .select(STRIPE_ORDER_SELECT_FIELDS.ID)
                            .lean(),
                        Subscription.findOne({ stripeSessionId })
                            .select(STRIPE_ORDER_SELECT_FIELDS.ID)
                            .lean(),
                    ]);

                    return {
                        sessionId: stripeSessionId,
                        presentInOrder: Boolean(orderDoc),
                        presentInSubscription: Boolean(subscriptionDoc),
                        orderId: orderDoc?._id ?? null,
                        subscriptionId: subscriptionDoc?._id ?? null,
                    };
                } catch (error) {
                    this.logger.error("Stripe session presence check failed", {
                        stripeSessionId,
                        reason: error.message,
                    });

                    throw createHttpError(500, STRIPE_MESSAGES.PRESENCE_CHECK_FAILED);
                }
            }

            async getUserSubscriptionStatus(userId) {
                this.logger.info("Reading the user subscription status", {
                    userId: String(userId),
                });

                try {
                    const subscription = await Subscription.findOne({
                        userId,
                        status: { $in: STRIPE_ACTIVE_SUBSCRIPTION_STATUSES },
                    })
                        .select(STRIPE_USER_SUBSCRIPTION_SELECT_FIELDS)
                        .populate({
                            path: "priceCatalogId",
                            select: "planId",
                            populate: { path: "planId", model: "Plan", select: "name" },
                        })
                        .lean();

                    return {
                        subscriptionStatus: subscription ? subscription.status : "none",
                        planName: subscription?.priceCatalogId?.planId?.name ?? null,
                        subscription: subscription
                            ? {
                                planId: subscription.planId,
                                planDuration: subscription.planDuration,
                                status: subscription.status,
                                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                                cancelAt: subscription.cancelAt,
                            }
                            : null,
                    };
                } catch (error) {
                    this.logger.error("User subscription status read failed", {
                        userId: String(userId),
                        reason: error.message,
                    });

                    throw createHttpError(
                        500,
                        STRIPE_MESSAGES.USER_SUBSCRIPTION_STATUS_FAILED,
                    );
                }
            }

            async findAssessmentIdBySessionOrOrder({ sessionId, orderId }) {
                this.logger.info("Reading an assessment id from an order", {
                    sessionId,
                    orderId,
                });

                try {
                    const order = sessionId
                        ? await Order.findOne({ stripeSessionId: sessionId })
                            .select(STRIPE_ORDER_SELECT_FIELDS.ASSESSMENT_ID)
                            .lean()
                        : await Order.findById(orderId)
                            .select(STRIPE_ORDER_SELECT_FIELDS.ASSESSMENT_ID)
                            .lean();

                    return order?.assessmentId ?? null;
                } catch (error) {
                    this.logger.error("Assessment id read failed", {
                        sessionId,
                        orderId,
                        reason: error.message,
                    });

                    throw createHttpError(500, STRIPE_MESSAGES.ASSESSMENT_ID_FAILED);
                }
            }

            async cancelSubscription({ userId, cancelAtPeriodEnd, body }) {
                this.logger.info("Cancelling a subscription", {
                    userId: String(userId),
                    cancelAtPeriodEnd,
                });

                const { cancelReason, wouldHaveStayedIfOffered } =
                    validateCancellationSurvey(body);
                const metadataPatch = buildCancellationMetadata(
                    cancelReason,
                    wouldHaveStayedIfOffered,
                );

                const subscription = await Subscription.findOne({ userId });

                if (!subscription) {
                    throw createHttpError(
                        404,
                        STRIPE_MESSAGES.NO_ACTIVE_SUBSCRIPTION_FOUND,
                    );
                }

                if (subscription.status === STRIPE_SUBSCRIPTION_STATUSES.CANCELED) {
                    throw createHttpError(
                        400,
                        STRIPE_MESSAGES.SUBSCRIPTION_ALREADY_CANCELED,
                    );
                }

                try {
                    const existing = await this.stripe.subscriptions.retrieve(
                        subscription.stripeSubscriptionId,
                    );
                    const mergedMetadata = {
                        ...(existing.metadata || {}),
                        ...metadataPatch,
                    };

                    let stripeSubscription;

                    if (cancelAtPeriodEnd) {
                        stripeSubscription = await this.stripe.subscriptions.update(
                            subscription.stripeSubscriptionId,
                            {
                                cancel_at_period_end: true,
                                metadata: mergedMetadata,
                            },
                        );
                    } else {
                        await this.stripe.subscriptions.update(
                            subscription.stripeSubscriptionId,
                            { metadata: mergedMetadata },
                        );
                        stripeSubscription = await this.stripe.subscriptions.cancel(
                            subscription.stripeSubscriptionId,
                        );
                    }

                    subscription.cancelAtPeriodEnd = cancelAtPeriodEnd;

                    if (cancelAtPeriodEnd) {
                        const cancelDate = toDateOrNull(
                            stripeSubscription.current_period_end,
                        );

                        if (cancelDate) {
                            subscription.cancelAt = cancelDate;
                        } else if (
                            !subscription.cancelAt ||
                            Number.isNaN(subscription.cancelAt.getTime())
                        ) {
                            subscription.cancelAt = null;
                        }
                    } else {
                        subscription.status = STRIPE_SUBSCRIPTION_STATUSES.CANCELED;
                        subscription.cancelAt = new Date();
                    }

                    subscription.cancelReason = cancelReason;
                    subscription.wouldHaveStayedIfOffered = wouldHaveStayedIfOffered;
                    subscription.metadata = mergedMetadata;

                    await subscription.save();

                    const user = await User.findById(userId)
                        .select(STRIPE_USER_SELECT_FIELDS)
                        .lean();

                    if (user?.email) {
                        await this.syncSubscriptionToKlaviyo({
                            userId,
                            email: user.email,
                            stripeSubscription,
                            subscriptionRecord: subscription,
                        });
                    }

                    this.logger.info("Subscription cancelled", {
                        userId: String(userId),
                        subscriptionId: String(subscription._id),
                        cancelAtPeriodEnd,
                    });

                    return {
                        subscription,
                        cancelReason,
                        wouldHaveStayedIfOffered,
                    };
                } catch (error) {
                    this.logger.error("Subscription cancellation failed", {
                        userId: String(userId),
                        reason: error.message,
                    });

                    throw createHttpError(
                        500,
                        STRIPE_MESSAGES.SUBSCRIPTION_CANCEL_FAILED,
                    );
                }
            }

            async completeTrialTransition(userId) {
                const startTime = Date.now();
                const requestId = buildRequestId();

                this.logger.info("Completing a trial transition", {
                    userId: String(userId),
                    trialRequestId: requestId,
                });

                try {
                    const subscription = await Subscription.findOne({
                        userId,
                        status: { $in: STRIPE_TRIAL_TRANSITION_STATUSES },
                    });

                    if (!subscription) {
                        return {
                            statusCode: 404,
                            status: RESPONSE_STATUS.ERROR,
                            message: STRIPE_MESSAGES.NO_TRIAL_SUBSCRIPTION_FOUND,
                            data: {
                                requestId,
                                step: STRIPE_TRIAL_STEPS.FIND_SUBSCRIPTION,
                                error: STRIPE_TRIAL_ERRORS.NO_TRIAL_STATUS,
                            },
                        };
                    }

                    let stripeSubscription;

                    try {
                        stripeSubscription = await this.stripe.subscriptions.retrieve(
                            subscription.stripeSubscriptionId,
                            {
                                expand: [
                                    "latest_invoice.payment_intent",
                                    "default_payment_method",
                                ],
                            },
                        );
                    } catch {
                        throw createHttpError(
                            500,
                            STRIPE_MESSAGES.RETRIEVE_SUBSCRIPTION_FAILED,
                        );
                    }

                    if (
                        !STRIPE_TRIAL_TRANSITION_STATUSES.includes(
                            stripeSubscription.status,
                        )
                    ) {
                        return {
                            statusCode: 400,
                            status: RESPONSE_STATUS.ERROR,
                            message: STRIPE_MESSAGE_BUILDERS.cannotEndTrial(
                                stripeSubscription.status,
                            ),
                            data: {
                                requestId,
                                step: STRIPE_TRIAL_STEPS.VALIDATE_STATUS,
                                localStatus: subscription.status,
                                stripeStatus: stripeSubscription.status,
                                error: STRIPE_TRIAL_ERRORS.INVALID_TRIAL_STATUS,
                            },
                        };
                    }

                    const latestInvoice = stripeSubscription.latest_invoice || null;
                    const paymentIntent = latestInvoice?.payment_intent || null;

                    if (
                        paymentIntent?.status ===
                        STRIPE_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION
                    ) {
                        return {
                            statusCode: 200,
                            status: RESPONSE_STATUS.SUCCESS,
                            message: STRIPE_MESSAGES.THREE_D_SECURE_BEFORE_TRIAL_END,
                            data: {
                                requestId,
                                action: STRIPE_TRIAL_RESPONSE_ACTIONS.REQUIRES_3DS,
                                subscription: {
                                    id: subscription._id,
                                    status: subscription.status,
                                    stripeSubscriptionId:
                                        subscription.stripeSubscriptionId,
                                },
                                authentication: {
                                    required: true,
                                    clientSecret: paymentIntent.client_secret,
                                    paymentIntentId: paymentIntent.id,
                                    paymentMethodId: paymentIntent.payment_method,
                                    amount: paymentIntent.amount,
                                    currency: paymentIntent.currency,
                                },
                                nextStep:
                                    STRIPE_TRIAL_NEXT_STEPS.COMPLETE_3DS_AND_RETRY,
                            },
                        };
                    }

                    if (
                        stripeSubscription.status ===
                        STRIPE_SUBSCRIPTION_STATUSES.TRIALING
                    ) {
                        return await this.endTrialImmediately({
                            requestId,
                            subscription,
                        });
                    }

                    if (
                        stripeSubscription.status ===
                            STRIPE_SUBSCRIPTION_STATUSES.PAST_DUE &&
                        paymentIntent?.status === STRIPE_PAYMENT_INTENT_STATUSES.FAILED
                    ) {
                        return {
                            statusCode: 200,
                            status: RESPONSE_STATUS.SUCCESS,
                            message: STRIPE_MESSAGES.PAYMENT_FAILED_UPDATE_METHOD,
                            data: {
                                requestId,
                                action: STRIPE_TRIAL_RESPONSE_ACTIONS.PAYMENT_FAILED,
                                subscription: {
                                    id: subscription._id,
                                    status: subscription.status,
                                    stripeSubscriptionId:
                                        subscription.stripeSubscriptionId,
                                },
                                paymentIssue: {
                                    reason: STRIPE_TRIAL_REASONS.PAYMENT_FAILED,
                                    lastError: paymentIntent.last_payment_error || null,
                                    paymentIntentId: paymentIntent.id,
                                    invoiceId: latestInvoice.id,
                                    amountDue: latestInvoice.amount_due,
                                },
                                nextStep: STRIPE_TRIAL_NEXT_STEPS.UPDATE_PAYMENT_METHOD,
                            },
                        };
                    }

                    return {
                        statusCode: 200,
                        status: RESPONSE_STATUS.SUCCESS,
                        message: STRIPE_MESSAGES.UNKNOWN_TRIAL_STATE,
                        data: {
                            requestId,
                            action: STRIPE_TRIAL_RESPONSE_ACTIONS.UNKNOWN,
                            subscription: {
                                id: subscription._id,
                                status: subscription.status,
                                stripeSubscriptionId: subscription.stripeSubscriptionId,
                            },
                            debug: {
                                subscriptionStatus: stripeSubscription.status,
                                paymentIntentStatus:
                                    paymentIntent?.status ||
                                    STRIPE_TRIAL_DEBUG_PLACEHOLDERS.NONE,
                                invoiceStatus:
                                    latestInvoice?.status ||
                                    STRIPE_TRIAL_DEBUG_PLACEHOLDERS.NONE,
                            },
                            nextStep: STRIPE_TRIAL_NEXT_STEPS.CONTACT_SUPPORT,
                        },
                    };
                } catch (error) {
                    const processingTime = Date.now() - startTime;

                    this.logger.error("Trial transition failed", {
                        userId: String(userId),
                        trialRequestId: requestId,
                        reason: error.message,
                    });

                    if (createHttpError.isHttpError(error)) {
                        return {
                            statusCode: error.statusCode,
                            status: RESPONSE_STATUS.ERROR,
                            message: error.message,
                            data: {
                                requestId,
                                error: error.message,
                                processingTime: `${processingTime}ms`,
                            },
                        };
                    }

                    return {
                        statusCode: 500,
                        status: RESPONSE_STATUS.ERROR,
                        message: STRIPE_MESSAGES.TRIAL_TRANSITION_FAILED,
                        data: {
                            requestId,
                            error: STRIPE_TRIAL_ERRORS.INTERNAL,
                            processingTime: `${processingTime}ms`,
                        },
                    };
                }
            }

            resolvePeriod(stripeSubscription, subscription) {
                const currentPeriodStart =
                    toDateOrNull(stripeSubscription.current_period_start) || new Date();
                const currentPeriodEnd =
                    toDateOrNull(stripeSubscription.current_period_end) ||
                    addCadence(currentPeriodStart, subscription.planDuration);

                return { currentPeriodStart, currentPeriodEnd };
            }

            async endTrialImmediately({ requestId, subscription }) {
                const previousSubscriptionStatus = subscription.status;
                const updated = await this.stripe.subscriptions.update(
                    subscription.stripeSubscriptionId,
                    { trial_end: "now" },
                );

                if (updated.status === STRIPE_SUBSCRIPTION_STATUSES.ACTIVE) {
                    const { currentPeriodStart, currentPeriodEnd } = this.resolvePeriod(
                        updated,
                        subscription,
                    );

                    subscription.status = STRIPE_SUBSCRIPTION_STATUSES.ACTIVE;
                    subscription.trialEnd = new Date();
                    subscription.currentPeriodStart = currentPeriodStart;
                    subscription.currentPeriodEnd = currentPeriodEnd;
                    subscription.nextBillingDate = currentPeriodEnd;
                    await subscription.save();

                    await this.syncTrialTransitionToKlaviyo({
                        subscription,
                        stripeSubscription: updated,
                        previousSubscriptionStatus,
                    });

                    return {
                        statusCode: 200,
                        status: RESPONSE_STATUS.SUCCESS,
                        message: STRIPE_MESSAGES.TRIAL_ENDED_SUBSCRIPTION_ACTIVE,
                        data: {
                            requestId,
                            action: STRIPE_TRIAL_RESPONSE_ACTIONS.TRIAL_ENDED,
                            subscription: {
                                id: subscription._id,
                                status: subscription.status,
                                stripeSubscriptionId: subscription.stripeSubscriptionId,
                                currentPeriodStart: subscription.currentPeriodStart,
                                currentPeriodEnd: subscription.currentPeriodEnd,
                                nextBillingDate: subscription.nextBillingDate,
                                trialEnd: subscription.trialEnd,
                            },
                        },
                    };
                }

                if (updated.status !== STRIPE_SUBSCRIPTION_STATUSES.PAST_DUE) {
                    return {
                        statusCode: 200,
                        status: RESPONSE_STATUS.SUCCESS,
                        message: STRIPE_MESSAGE_BUILDERS.trialProcessingCompleted(
                            updated.status,
                        ),
                        data: {
                            requestId,
                            action: STRIPE_TRIAL_RESPONSE_ACTIONS.UNEXPECTED_STATUS,
                            subscription: {
                                id: subscription._id,
                                status: updated.status,
                                stripeSubscriptionId: subscription.stripeSubscriptionId,
                            },
                            error: STRIPE_MESSAGE_BUILDERS.unexpectedStatusAfterTrialEnd(
                                updated.status,
                            ),
                        },
                    };
                }

                return await this.resolvePastDueInvoice({
                    requestId,
                    subscription,
                    latestInvoiceId: updated.latest_invoice,
                    previousSubscriptionStatus,
                });
            }

            async syncTrialTransitionToKlaviyo({
                subscription,
                stripeSubscription,
                invoice,
                previousSubscriptionStatus,
            }) {
                if (!subscription.userId) {
                    return;
                }

                const user = await User.findById(subscription.userId)
                    .select(STRIPE_USER_SELECT_FIELDS)
                    .lean();

                if (!user?.email) {
                    return;
                }

                await this.syncSubscriptionToKlaviyo({
                    userId: subscription.userId,
                    email: user.email,
                    stripeSubscription,
                    invoice,
                    subscriptionRecord: subscription,
                    previousSubscriptionStatus,
                });
            }

            async resolvePastDueInvoice({
                requestId,
                subscription,
                latestInvoiceId,
                previousSubscriptionStatus,
            }) {
                const invoice = await this.stripe.invoices.retrieve(latestInvoiceId, {
                    expand: ["payment_intent", "payment_intent.payment_method"],
                });

                let paymentIntent = invoice.payment_intent;

                if (!paymentIntent && invoice.amount_due > 0) {
                    try {
                        const paidInvoice = await this.stripe.invoices.pay(invoice.id, {
                            expand: ["payment_intent"],
                        });

                        if (
                            paidInvoice.status === "paid" &&
                            paidInvoice.amount_paid > 0
                        ) {
                            const finalSubscription =
                                await this.stripe.subscriptions.retrieve(
                                    subscription.stripeSubscriptionId,
                                );
                            const { currentPeriodStart, currentPeriodEnd } =
                                this.resolvePeriod(finalSubscription, subscription);

                            const data = {
                                requestId,
                                action: STRIPE_TRIAL_RESPONSE_ACTIONS.SUBSCRIPTION_ACTIVATED,
                                subscription: {
                                    id: subscription._id,
                                    status: finalSubscription.status,
                                    stripeSubscriptionId:
                                        subscription.stripeSubscriptionId,
                                    currentPeriodStart,
                                    currentPeriodEnd,
                                },
                                payment: {
                                    successful: true,
                                    invoiceId: paidInvoice.id,
                                    amountPaid: paidInvoice.amount_paid,
                                    currency: paidInvoice.currency,
                                    paidAt: new Date().toISOString(),
                                },
                                nextStep: STRIPE_TRIAL_NEXT_STEPS.SUBSCRIPTION_ACTIVE,
                            };

                            subscription.status = finalSubscription.status;
                            subscription.trialEnd = new Date();
                            subscription.currentPeriodStart = currentPeriodStart;
                            subscription.currentPeriodEnd = currentPeriodEnd;
                            await subscription.save();

                            await this.syncTrialTransitionToKlaviyo({
                                subscription,
                                stripeSubscription: finalSubscription,
                                invoice: paidInvoice,
                                previousSubscriptionStatus,
                            });

                            return {
                                statusCode: 200,
                                status: RESPONSE_STATUS.SUCCESS,
                                message: STRIPE_MESSAGES.TRIAL_ENDED_AND_ACTIVATED,
                                data,
                            };
                        }

                        paymentIntent = paidInvoice.payment_intent;
                    } catch (error) {
                        if (error.payment_intent) {
                            paymentIntent = error.payment_intent;
                        }
                    }
                }

                subscription.status = STRIPE_SUBSCRIPTION_STATUSES.PAST_DUE;
                subscription.trialEnd = new Date();

                if (
                    paymentIntent?.status ===
                    STRIPE_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION
                ) {
                    const data = {
                        requestId,
                        action: STRIPE_TRIAL_RESPONSE_ACTIONS.REQUIRES_3DS,
                        subscription: {
                            id: subscription._id,
                            status: STRIPE_SUBSCRIPTION_STATUSES.PAST_DUE,
                            stripeSubscriptionId: subscription.stripeSubscriptionId,
                        },
                        authentication: {
                            required: true,
                            clientSecret: paymentIntent.client_secret,
                            paymentIntentId: paymentIntent.id,
                            paymentMethodId: paymentIntent.payment_method,
                            amount: paymentIntent.amount,
                            currency: paymentIntent.currency,
                        },
                        nextStep: STRIPE_TRIAL_NEXT_STEPS.COMPLETE_3DS_TO_ACTIVATE,
                    };

                    await subscription.save();

                    return {
                        statusCode: 200,
                        status: RESPONSE_STATUS.SUCCESS,
                        message: STRIPE_MESSAGES.TRIAL_ENDED_NEEDS_THREE_D_SECURE,
                        data,
                    };
                }

                if (!paymentIntent && invoice.amount_due > 0) {
                    const data = {
                        requestId,
                        action: STRIPE_TRIAL_RESPONSE_ACTIONS.PAYMENT_METHOD_REQUIRED,
                        subscription: {
                            id: subscription._id,
                            status: STRIPE_SUBSCRIPTION_STATUSES.PAST_DUE,
                            stripeSubscriptionId: subscription.stripeSubscriptionId,
                        },
                        paymentIssue: {
                            reason: STRIPE_TRIAL_REASONS.NO_PAYMENT_METHOD,
                            message: STRIPE_TRIAL_ERRORS.NO_PAYMENT_INTENT,
                            invoiceId: invoice.id,
                            amountDue: invoice.amount_due,
                            currency: invoice.currency,
                        },
                        nextStep: STRIPE_TRIAL_NEXT_STEPS.ADD_PAYMENT_METHOD,
                    };

                    await subscription.save();

                    return {
                        statusCode: 200,
                        status: RESPONSE_STATUS.SUCCESS,
                        message: STRIPE_MESSAGES.TRIAL_ENDED_WITHOUT_PAYMENT_METHOD,
                        data,
                    };
                }

                if (paymentIntent?.status === STRIPE_PAYMENT_INTENT_STATUSES.FAILED) {
                    const data = {
                        requestId,
                        action: STRIPE_TRIAL_RESPONSE_ACTIONS.PAYMENT_FAILED,
                        subscription: {
                            id: subscription._id,
                            status: STRIPE_SUBSCRIPTION_STATUSES.PAST_DUE,
                            stripeSubscriptionId: subscription.stripeSubscriptionId,
                        },
                        paymentIssue: {
                            reason: STRIPE_TRIAL_REASONS.PAYMENT_FAILED,
                            lastError: paymentIntent.last_payment_error || null,
                            paymentIntentId: paymentIntent.id,
                            invoiceId: invoice.id,
                            amountDue: invoice.amount_due,
                        },
                        nextStep: STRIPE_TRIAL_NEXT_STEPS.UPDATE_PAYMENT_METHOD,
                    };

                    await subscription.save();

                    return {
                        statusCode: 200,
                        status: RESPONSE_STATUS.SUCCESS,
                        message: STRIPE_MESSAGES.TRIAL_ENDED_PAYMENT_FAILED,
                        data,
                    };
                }

                const data = {
                    requestId,
                    action: STRIPE_TRIAL_RESPONSE_ACTIONS.UNEXPECTED_PAYMENT_STATUS,
                    subscription: {
                        id: subscription._id,
                        status: STRIPE_SUBSCRIPTION_STATUSES.PAST_DUE,
                        stripeSubscriptionId: subscription.stripeSubscriptionId,
                    },
                    debug: {
                        paymentIntentStatus:
                            paymentIntent?.status ||
                            STRIPE_TRIAL_DEBUG_PLACEHOLDERS.NONE,
                        invoiceStatus: invoice.status,
                        amountDue: invoice.amount_due,
                        paymentIntentId:
                            paymentIntent?.id || STRIPE_TRIAL_DEBUG_PLACEHOLDERS.NONE,
                    },
                    nextStep: STRIPE_TRIAL_NEXT_STEPS.CONTACT_SUPPORT_INVESTIGATION,
                };

                await subscription.save();

                return {
                    statusCode: 200,
                    status: RESPONSE_STATUS.SUCCESS,
                    message: STRIPE_MESSAGE_BUILDERS.unexpectedPaymentStatus(
                        paymentIntent?.status ||
                            STRIPE_TRIAL_DEBUG_PLACEHOLDERS.UNKNOWN,
                    ),
                    data,
                };
            }

            async handleSubscriptionCreated(stripeSubscription) {
                try {
                    const userId = stripeSubscription.metadata?.userId;

                    if (!userId) {
                        this.logger.warn("Subscription webhook without a user", {
                            subscriptionId: stripeSubscription.id,
                        });

                        return;
                    }

                    const user = await User.findById(userId);

                    if (!user) {
                        this.logger.warn("Subscription webhook for a missing user", {
                            userId,
                        });

                        return;
                    }

                    const subscriptionCount = await Subscription.countDocuments({
                        userId: user._id,
                    });

                    if (subscriptionCount === 0 && user.landingPageName) {
                        await this.sendSetPasswordEmail(user);
                    }

                    const planId = stripeSubscription.metadata?.planId;

                    if (!planId) {
                        this.logger.warn("Subscription webhook without a plan", {
                            subscriptionId: stripeSubscription.id,
                        });

                        return;
                    }

                    const plan = await Plan.findById(planId);

                    if (!plan) {
                        this.logger.warn("Subscription webhook for a missing plan", {
                            planId,
                        });

                        return;
                    }

                    const actualInterval =
                        stripeSubscription.plan?.interval ||
                        stripeSubscription.items?.data?.[0]?.plan?.interval;
                    const recurringCadence =
                        actualInterval === "year"
                            ? STRIPE_CADENCES.YEARLY
                            : STRIPE_CADENCES.MONTHLY;

                    const stripePriceId =
                        stripeSubscription.plan?.id ||
                        stripeSubscription.items?.data?.[0]?.price?.id;
                    const priceCatalog = await PriceCatalog.findOne({ stripePriceId });

                    if (!priceCatalog) {
                        this.logger.warn("Subscription webhook without a price", {
                            stripePriceId,
                        });

                        return;
                    }

                    const subscriptionItem = stripeSubscription.items?.data?.[0];
                    const periodStart =
                        subscriptionItem?.current_period_start ||
                        stripeSubscription.current_period_start;
                    const periodEnd =
                        subscriptionItem?.current_period_end ||
                        stripeSubscription.current_period_end;

                    const sessionId =
                        await this.findCheckoutSessionId(stripeSubscription);

                    const subscriptionData = {
                        userId: user._id,
                        stripeSubscriptionId: stripeSubscription.id,
                        stripeSessionId: sessionId,
                        priceCatalogId: priceCatalog._id,
                        planId,
                        status: stripeSubscription.status,
                        planDuration: recurringCadence,
                        currentPeriodStart: toDateOrNow(periodStart),
                        currentPeriodEnd: toDateOrNow(periodEnd),
                        cancelAtPeriodEnd:
                            stripeSubscription.cancel_at_period_end || false,
                        metadata: {
                            ...(stripeSubscription.metadata || {}),
                            subscriptionStart: new Date(
                                (stripeSubscription.start_date ||
                                    stripeSubscription.created ||
                                    Math.floor(Date.now() / 1000)) * 1000,
                            ).toISOString(),
                            ...(sessionId ? { sessionId } : {}),
                        },
                    };

                    if (stripeSubscription.trial_start) {
                        subscriptionData.trialStart = toDateOrNow(
                            stripeSubscription.trial_start,
                        );
                    }

                    if (stripeSubscription.trial_end) {
                        subscriptionData.trialEnd = toDateOrNow(
                            stripeSubscription.trial_end,
                        );
                    }

                    if (stripeSubscription.cancel_at) {
                        subscriptionData.cancelAt = toDateOrNow(
                            stripeSubscription.cancel_at,
                        );
                    }

                    const subscription = await Subscription.create(subscriptionData);

                    this.logger.info("Subscription stored from a webhook", {
                        userId: String(user._id),
                        subscriptionId: String(subscription._id),
                    });

                    try {
                        await this.fetchAndRecordLatestInvoice(stripeSubscription.id);

                        if (stripeSubscription.latest_invoice) {
                            const latestInvoice = await this.stripe.invoices.retrieve(
                                stripeSubscription.latest_invoice,
                                { expand: ["subscription", "lines.data.subscription"] },
                            );

                            if (!latestInvoice.subscription) {
                                latestInvoice.subscription = stripeSubscription.id;
                            }

                            await this.handleInvoicePaymentSucceeded(latestInvoice);
                        }
                    } catch (error) {
                        this.logger.error("Invoice backfill failed", {
                            subscriptionId: stripeSubscription.id,
                            reason: error.message,
                        });
                    }

                    if (!user.stripeCustomerId && stripeSubscription.customer) {
                        user.stripeCustomerId = stripeSubscription.customer;
                        await user.save();
                    }

                    if (stripeSubscription.default_payment_method) {
                        const pmId = paymentMethodId(
                            stripeSubscription.default_payment_method,
                        );

                        if (pmId && pmId !== user.defaultPaymentMethodId) {
                            user.defaultPaymentMethodId = pmId;
                            await user.save();

                            if (user.stripeCustomerId) {
                                try {
                                    await this.stripe.customers.update(
                                        user.stripeCustomerId,
                                        {
                                            invoice_settings: {
                                                default_payment_method: pmId,
                                            },
                                        },
                                    );
                                } catch (error) {
                                    this.logger.warn(
                                        "Stripe customer payment method update failed",
                                        { reason: error.message },
                                    );
                                }
                            }
                        }
                    }

                    if (user.email) {
                        await this.syncSubscriptionToKlaviyo({
                            userId: user._id,
                            email: user.email,
                            stripeSubscription,
                            subscriptionRecord: subscription,
                        });
                    }
                } catch (error) {
                    this.logger.error("Subscription created webhook failed", {
                        reason: error.message,
                    });
                }
            }

            async sendSetPasswordEmail(user) {
                try {
                    const resetToken = jwt.sign(
                        { userId: user._id },
                        config.JWT_SECRET,
                        { expiresIn: STRIPE_SET_PASSWORD_EMAIL.TOKEN_EXPIRY },
                    );
                    const resetUrl = `${config.FRONTEND_URL}/forgot-password/${resetToken}`;

                    if (!this.sendEmail) {
                        return;
                    }

                    this.logger.info("Set password email sent", {
                        userId: String(user._id),
                    });
                } catch (error) {
                    this.logger.error("Set password email failed", {
                        userId: String(user._id),
                        reason: error.message,
                    });
                }
            }

            async findCheckoutSessionId(stripeSubscription) {
                const flow = stripeSubscription.metadata?.flow;

                if (
                    flow !== STRIPE_FLOWS.SUBSCRIPTION_CHECKOUT &&
                    flow !== STRIPE_FLOWS.PAID_TRIAL_CHECKOUT
                ) {
                    return null;
                }

                try {
                    const sessions = await this.stripe.checkout.sessions.list({
                        customer: stripeSubscription.customer,
                        limit: STRIPE_WEBHOOK_LIMITS.CHECKOUT_SESSIONS,
                    });

                    const matching = sessions.data.find(
                        (session) =>
                            session.subscription === stripeSubscription.id ||
                            (session.metadata?.subscriptionType ===
                                stripeSubscription.metadata?.subscriptionType &&
                                session.metadata?.planId ===
                                    stripeSubscription.metadata?.planId &&
                                Math.abs(session.created - stripeSubscription.created) <
                                    STRIPE_WEBHOOK_SESSION_MATCH_WINDOW_SECONDS),
                    );

                    return matching ? matching.id : null;
                } catch (error) {
                    this.logger.warn("Checkout session lookup failed", {
                        subscriptionId: stripeSubscription.id,
                        reason: error.message,
                    });

                    return null;
                }
            }

            applyCancellationMetadata(subscription, metadata = {}) {
                if (
                    Object.prototype.hasOwnProperty.call(
                        metadata,
                        STRIPE_CANCELLATION_METADATA_KEYS.CANCEL_REASON,
                    )
                ) {
                    subscription.cancelReason =
                        metadata[STRIPE_CANCELLATION_METADATA_KEYS.CANCEL_REASON] ||
                        null;
                }

                if (
                    Object.prototype.hasOwnProperty.call(
                        metadata,
                        STRIPE_CANCELLATION_METADATA_KEYS.STAY_IF_OFFERED,
                    )
                ) {
                    const raw =
                        metadata[STRIPE_CANCELLATION_METADATA_KEYS.STAY_IF_OFFERED];

                    subscription.wouldHaveStayedIfOffered = raw
                        ? parseStayIfOffered(raw)
                        : [];
                }
            }

            async handleSubscriptionUpdated(stripeSubscription) {
                try {
                    const subscription = await Subscription.findOne({
                        stripeSubscriptionId: stripeSubscription.id,
                    });

                    if (!subscription) {
                        this.logger.warn("Subscription update for an unknown row", {
                            subscriptionId: stripeSubscription.id,
                        });

                        return;
                    }

                    const previousStatus = subscription.status;
                    let fresh = stripeSubscription;

                    try {
                        fresh = await this.stripe.subscriptions.retrieve(
                            stripeSubscription.id,
                        );
                    } catch (error) {
                        this.logger.warn("Fresh subscription fetch failed", {
                            subscriptionId: stripeSubscription.id,
                            reason: error.message,
                        });
                    }

                    subscription.status = fresh.status;

                    const newPeriodStart = toDateOrNull(fresh.current_period_start);
                    const newPeriodEnd = toDateOrNull(fresh.current_period_end);

                    if (newPeriodStart) {
                        subscription.currentPeriodStart = newPeriodStart;
                    }

                    if (newPeriodEnd) {
                        subscription.currentPeriodEnd = newPeriodEnd;
                    }

                    subscription.cancelAtPeriodEnd =
                        fresh.cancel_at_period_end || false;
                    subscription.cancelAt = fresh.cancel_at
                        ? toDateOrNull(fresh.cancel_at)
                        : null;

                    if (fresh.trial_start) {
                        subscription.trialStart = toDateOrNull(fresh.trial_start);
                    }

                    if (fresh.trial_end) {
                        subscription.trialEnd = toDateOrNull(fresh.trial_end);
                    }

                    subscription.metadata = fresh.metadata || subscription.metadata;

                    this.applyCancellationMetadata(subscription, fresh.metadata || {});

                    await subscription.save();

                    this.logger.info("Subscription updated from a webhook", {
                        subscriptionId: String(subscription._id),
                        previousStatus,
                        status: subscription.status,
                    });

                    if (
                        previousStatus !== STRIPE_SUBSCRIPTION_STATUSES.ACTIVE &&
                        fresh.status === STRIPE_SUBSCRIPTION_STATUSES.ACTIVE
                    ) {
                        try {
                            await this.fetchAndRecordLatestInvoice(fresh.id);
                        } catch (error) {
                            this.logger.error("Invoice refresh failed", {
                                reason: error.message,
                            });
                        }
                    }
                } catch (error) {
                    this.logger.error("Subscription updated webhook failed", {
                        reason: error.message,
                    });
                }
            }

            async handleSubscriptionDeleted(stripeSubscription) {
                try {
                    const subscription = await Subscription.findOne({
                        stripeSubscriptionId: stripeSubscription.id,
                    });

                    if (!subscription) {
                        this.logger.warn("Subscription deletion for an unknown row", {
                            subscriptionId: stripeSubscription.id,
                        });

                        return;
                    }

                    this.applyCancellationMetadata(
                        subscription,
                        stripeSubscription.metadata || {},
                    );

                    subscription.status = STRIPE_SUBSCRIPTION_STATUSES.CANCELED;
                    await subscription.save();

                    this.logger.info("Subscription canceled from a webhook", {
                        subscriptionId: String(subscription._id),
                    });
                } catch (error) {
                    this.logger.error("Subscription deleted webhook failed", {
                        reason: error.message,
                    });
                }
            }

            async resolveInvoiceSubscriptionId(invoice) {
                if (invoice.subscription) {
                    return invoice.subscription;
                }

                const lineSubscription = invoice.lines?.data?.[0]?.subscription;

                if (lineSubscription) {
                    return lineSubscription;
                }

                if (invoice.customer) {
                    try {
                        const subscriptions = await this.stripe.subscriptions.list({
                            customer: invoice.customer,
                            status: "all",
                            limit: STRIPE_WEBHOOK_LIMITS.SUBSCRIPTIONS,
                        });

                        for (const candidate of subscriptions.data) {
                            if (
                                candidate.status !==
                                    STRIPE_SUBSCRIPTION_STATUSES.ACTIVE &&
                                candidate.status !==
                                    STRIPE_SUBSCRIPTION_STATUSES.TRIALING
                            ) {
                                continue;
                            }

                            const candidateInvoices = await this.stripe.invoices.list({
                                subscription: candidate.id,
                                limit: STRIPE_WEBHOOK_LIMITS.SUBSCRIPTION_INVOICES,
                            });

                            if (
                                candidateInvoices.data.some(
                                    (candidateInvoice) =>
                                        candidateInvoice.id === invoice.id,
                                )
                            ) {
                                return candidate.id;
                            }
                        }
                    } catch (error) {
                        this.logger.warn("Subscription lookup by customer failed", {
                            reason: error.message,
                        });
                    }
                }

                try {
                    const refreshed = await this.stripe.invoices.retrieve(invoice.id, {
                        expand: ["subscription", "lines.data.subscription"],
                    });

                    return (
                        refreshed.subscription ||
                        refreshed.lines?.data?.[0]?.subscription ||
                        null
                    );
                } catch (error) {
                    this.logger.warn("Invoice refetch failed", {
                        reason: error.message,
                    });

                    return null;
                }
            }

            async handleInvoicePaymentSucceeded(invoice) {
                try {
                    const subscriptionId =
                        await this.resolveInvoiceSubscriptionId(invoice);

                    if (!subscriptionId) {
                        this.logger.warn("Invoice without a resolvable subscription", {
                            invoiceId: invoice.id,
                        });

                        return;
                    }

                    const subscription = await Subscription.findOne({
                        stripeSubscriptionId: subscriptionId,
                    });

                    if (!subscription) {
                        this.logger.warn("Invoice for an unknown subscription", {
                            subscriptionId,
                        });

                        return;
                    }

                    const previousSubscriptionStatus = subscription.status;

                    if (
                        subscription.billingAmounts.some(
                            (record) => record.invoiceId === invoice.id,
                        )
                    ) {
                        return;
                    }

                    const similar = subscription.billingAmounts.find(
                        (record) =>
                            record.amount ===
                                invoice.amount_paid / STRIPE_AMOUNT_DIVISOR &&
                            record.currency === invoice.currency &&
                            Math.abs(
                                new Date(record.date).getTime() -
                                    new Date(invoice.created * 1000).getTime(),
                            ) < STRIPE_DUPLICATE_INVOICE_WINDOW_MS,
                    );

                    if (similar && !similar.invoiceId) {
                        return;
                    }

                    subscription.billingAmounts.push({
                        amount: invoice.amount_paid / STRIPE_AMOUNT_DIVISOR,
                        currency: invoice.currency,
                        date: new Date(invoice.created * 1000),
                        invoiceId: invoice.id,
                        billingReason:
                            invoice.billing_reason ||
                            STRIPE_BILLING_REASONS.SUBSCRIPTION_CYCLE,
                    });

                    const linePeriod = invoice.lines?.data?.[0]?.period;

                    if (linePeriod?.start) {
                        subscription.currentPeriodStart = new Date(
                            linePeriod.start * 1000,
                        );
                    }

                    if (linePeriod?.end) {
                        subscription.currentPeriodEnd = new Date(linePeriod.end * 1000);
                        subscription.nextBillingDate = new Date(linePeriod.end * 1000);
                    }

                    let stripeSubscription = null;

                    try {
                        stripeSubscription =
                            await this.stripe.subscriptions.retrieve(subscriptionId);

                        if (
                            stripeSubscription.status &&
                            stripeSubscription.status !== subscription.status
                        ) {
                            subscription.status = stripeSubscription.status;
                        }

                        const newPeriodStart = toDateOrNull(
                            stripeSubscription.current_period_start,
                        );
                        const newPeriodEnd = toDateOrNull(
                            stripeSubscription.current_period_end,
                        );

                        if (newPeriodStart) {
                            subscription.currentPeriodStart = newPeriodStart;
                        }

                        if (newPeriodEnd) {
                            subscription.currentPeriodEnd = newPeriodEnd;
                        }

                        if (
                            linePeriod &&
                            newPeriodStart &&
                            newPeriodEnd &&
                            Math.abs(
                                newPeriodStart.getTime() - newPeriodEnd.getTime(),
                            ) < STRIPE_SAME_PERIOD_TOLERANCE_MS
                        ) {
                            const linePeriodStart = toDateOrNull(linePeriod.start);
                            const linePeriodEnd = toDateOrNull(linePeriod.end);

                            if (linePeriodStart) {
                                subscription.currentPeriodStart = linePeriodStart;
                            }

                            if (linePeriodEnd) {
                                subscription.currentPeriodEnd = linePeriodEnd;
                            }
                        }

                        subscription.cancelAtPeriodEnd =
                            stripeSubscription.cancel_at_period_end || false;

                        if (stripeSubscription.cancel_at) {
                            subscription.cancelAt = toDateOrNull(
                                stripeSubscription.cancel_at,
                            );
                        }

                        // The trial's $0 invoice line has a zero-length period
                        // (start === end), so the period/invoice-line logic above
                        // can't tell it apart from a real cycle. While trialing, the
                        // period always ends at trial_end, not at the invoice line.
                        if (
                            stripeSubscription.status ===
                                STRIPE_SUBSCRIPTION_STATUSES.TRIALING &&
                            stripeSubscription.trial_end
                        ) {
                            const trialEnd = toDateOrNull(stripeSubscription.trial_end);

                            if (trialEnd) {
                                subscription.currentPeriodEnd = trialEnd;
                                subscription.nextBillingDate = trialEnd;
                            }
                        }
                    } catch (error) {
                        this.logger.warn("Subscription refresh after invoice failed", {
                            reason: error.message,
                        });
                    }

                    await subscription.save();

                    this.logger.info("Invoice payment recorded", {
                        subscriptionId: String(subscription._id),
                        invoiceId: invoice.id,
                    });

                    if (subscription.userId) {
                        const user = await User.findById(subscription.userId)
                            .select(STRIPE_USER_SELECT_FIELDS)
                            .lean();

                        if (user?.email) {
                            await this.syncSubscriptionToKlaviyo({
                                userId: subscription.userId,
                                email: user.email,
                                stripeSubscription,
                                invoice,
                                subscriptionRecord: subscription,
                                previousSubscriptionStatus,
                            });
                        }
                    }
                } catch (error) {
                    this.logger.error("Invoice payment webhook failed", {
                        reason: error.message,
                    });
                }
            }

            async fetchAndRecordLatestInvoice(stripeSubscriptionId) {
                try {
                    const invoices = await this.stripe.invoices.list({
                        subscription: stripeSubscriptionId,
                        limit: STRIPE_WEBHOOK_LIMITS.INVOICES,
                    });

                    for (const invoice of invoices.data) {
                        if (invoice.status === "paid" && invoice.amount_paid > 0) {
                            await this.handleInvoicePaymentSucceeded(invoice);
                        }
                    }
                } catch (error) {
                    this.logger.error("Invoice list failed", {
                        subscriptionId: stripeSubscriptionId,
                        reason: error.message,
                    });
                }
            }

            async handleInvoicePaymentFailed(invoice) {
                try {
                    if (!invoice.subscription) {
                        return;
                    }

                    const subscription = await Subscription.findOne({
                        stripeSubscriptionId: invoice.subscription,
                    });

                    if (!subscription) {
                        this.logger.warn("Failed invoice for an unknown subscription", {
                            subscriptionId: invoice.subscription,
                        });

                        return;
                    }

                    const stripeSubscription = await this.stripe.subscriptions.retrieve(
                        invoice.subscription,
                    );

                    subscription.status = stripeSubscription.status;
                    await subscription.save();

                    this.logger.info("Invoice failure recorded", {
                        subscriptionId: String(subscription._id),
                    });
                } catch (error) {
                    this.logger.error("Invoice failure webhook failed", {
                        reason: error.message,
                    });
                }
            }

            async handleTrialWillEnd(stripeSubscription) {
                try {
                    const subscription = await Subscription.findOne({
                        stripeSubscriptionId: stripeSubscription.id,
                    });

                    if (!subscription) {
                        this.logger.warn("Trial ending for an unknown subscription", {
                            subscriptionId: stripeSubscription.id,
                        });

                        return;
                    }

                    this.logger.info("Trial will end", {
                        subscriptionId: String(subscription._id),
                        trialEnd: subscription.trialEnd,
                    });
                } catch (error) {
                    this.logger.error("Trial will end webhook failed", {
                        reason: error.message,
                    });
                }
            }

            async recordAssessmentPurchase(order, createdAt) {
                await this.syncAssessmentPurchaseToKlaviyo({
                    order,
                    purchasedAtISO: createdAt
                        ? new Date(createdAt * 1000).toISOString()
                        : new Date().toISOString(),
                });
            }

            async adoptPaymentMethod(user, paymentMethod) {
                const pmId = paymentMethodId(paymentMethod);

                if (!pmId) {
                    return;
                }

                user.defaultPaymentMethodId = pmId;

                if (user.stripeCustomerId) {
                    await this.stripe.customers.update(user.stripeCustomerId, {
                        invoice_settings: { default_payment_method: pmId },
                    });
                }
            }

            async handleCheckoutSessionCompleted(session) {
                const order = await Order.findOne({ stripeSessionId: session.id });

                if (!order) {
                    return;
                }

                const wasSucceeded = order.status === ORDER_STATUSES.SUCCEEDED;

                order.status = ORDER_STATUSES.SUCCEEDED;
                order.stripePaymentIntentId =
                    session.payment_intent || order.stripePaymentIntentId || null;
                order.stripeCustomerId =
                    session.customer || order.stripeCustomerId || null;
                await order.save();

                const user = await User.findById(order.userId);

                if (user) {
                    if (!user.stripeCustomerId && session.customer) {
                        user.stripeCustomerId = session.customer;
                    }

                    if (session.payment_intent) {
                        const paymentIntent = await this.stripe.paymentIntents.retrieve(
                            session.payment_intent,
                        );

                        await this.adoptPaymentMethod(
                            user,
                            paymentIntent.payment_method,
                        );
                    }

                    await user.save();
                }

                this.logger.info("Checkout session completed", {
                    orderId: String(order._id),
                    sessionId: session.id,
                });

                if (!wasSucceeded && order.assessmentId) {
                    await this.recordAssessmentPurchase(order, session?.created);
                }
            }

            async handlePaymentIntentSucceeded(paymentIntent) {
                const order = await Order.findOne({
                    stripePaymentIntentId: paymentIntent.id,
                });

                if (!order) {
                    return;
                }

                const wasSucceeded = order.status === ORDER_STATUSES.SUCCEEDED;

                order.status = ORDER_STATUSES.SUCCEEDED;
                order.stripeCustomerId =
                    paymentIntent.customer || order.stripeCustomerId || null;
                await order.save();

                const user = await User.findById(order.userId);

                if (user) {
                    if (!user.stripeCustomerId && paymentIntent.customer) {
                        user.stripeCustomerId = paymentIntent.customer;
                    }

                    if (paymentIntent.payment_method) {
                        await this.adoptPaymentMethod(
                            user,
                            paymentIntent.payment_method,
                        );
                    }

                    await user.save();
                }

                this.logger.info("Payment intent succeeded", {
                    orderId: String(order._id),
                    paymentIntentId: paymentIntent.id,
                });

                if (!wasSucceeded && order.assessmentId) {
                    await this.recordAssessmentPurchase(order, paymentIntent?.created);
                }
            }

            async setOrderStatus({ filter, status }) {
                const order = await Order.findOne(filter);

                if (!order) {
                    return;
                }

                order.status = status;
                await order.save();

                this.logger.info("Order status updated from a webhook", {
                    orderId: String(order._id),
                    status,
                });
            }

            async handleAsyncPaymentSucceeded(session) {
                const order = await Order.findOne({ stripeSessionId: session.id });

                if (!order) {
                    return;
                }

                const wasSucceeded = order.status === ORDER_STATUSES.SUCCEEDED;

                order.status = ORDER_STATUSES.SUCCEEDED;
                order.stripePaymentIntentId =
                    session.payment_intent || order.stripePaymentIntentId || null;
                order.stripeCustomerId =
                    session.customer || order.stripeCustomerId || null;
                await order.save();

                if (!wasSucceeded && order.assessmentId) {
                    await this.recordAssessmentPurchase(order, session?.created);
                }
            }

            async handleElementsSubscriptionCreated(stripeSubscription) {
                try {
                    const recurringPriceId =
                        stripeSubscription.metadata?.recurringPriceId ||
                        stripeSubscription.items?.data?.[0]?.price?.id ||
                        stripeSubscription.plan?.id;
                    const user = stripeSubscription.customer
                        ? await User.findOne({
                            stripeCustomerId: stripeSubscription.customer,
                        })
                        : null;
                    const priceCatalog = recurringPriceId
                        ? await PriceCatalog.findOne({
                            stripePriceId: recurringPriceId,
                        })
                        : null;
                    const priorSubscriptionCount = user
                        ? await Subscription.countDocuments({ userId: user._id })
                        : 0;
                    const interval =
                        stripeSubscription.items?.data?.[0]?.price?.recurring
                            ?.interval || stripeSubscription.plan?.interval;
                    const planDuration =
                        interval === "year"
                            ? STRIPE_CADENCES.YEARLY
                            : STRIPE_CADENCES.MONTHLY;

                    const existing = await Subscription.findOne({
                        stripeSubscriptionId: stripeSubscription.id,
                    });

                    if (existing) {
                        const previousSubscriptionStatus = existing.status;

                        existing.status = stripeSubscription.status;
                        existing.currentPeriodStart =
                            toDateOrNull(stripeSubscription.current_period_start) ||
                            existing.currentPeriodStart;
                        existing.currentPeriodEnd =
                            toDateOrNull(stripeSubscription.current_period_end) ||
                            existing.currentPeriodEnd;
                        existing.nextBillingDate = existing.currentPeriodEnd;
                        existing.cancelAtPeriodEnd =
                            stripeSubscription.cancel_at_period_end || false;

                        if (user && !existing.userId) {
                            existing.userId = user._id;
                            existing.isElementsFlow = false;
                        }

                        if (stripeSubscription.trial_start) {
                            existing.trialStart = toDateOrNull(
                                stripeSubscription.trial_start,
                            );
                        }

                        if (stripeSubscription.trial_end) {
                            existing.trialEnd = toDateOrNull(
                                stripeSubscription.trial_end,
                            );
                        }

                        await existing.save();

                        if (user?.email && existing.userId) {
                            await this.syncSubscriptionToKlaviyo({
                                userId: existing.userId,
                                email: user.email,
                                stripeSubscription,
                                subscriptionRecord: existing,
                                previousSubscriptionStatus,
                            });
                        }

                        return;
                    }

                    const subscriptionData = {
                        stripeSubscriptionId: stripeSubscription.id,
                        isElementsFlow: !user,
                        status: stripeSubscription.status,
                        planDuration,
                        currentPeriodStart:
                            toDateOrNull(stripeSubscription.current_period_start) ||
                            new Date(),
                        currentPeriodEnd:
                            toDateOrNull(stripeSubscription.current_period_end) ||
                            new Date(),
                        nextBillingDate:
                            toDateOrNull(stripeSubscription.current_period_end) ||
                            new Date(),
                        cancelAtPeriodEnd:
                            stripeSubscription.cancel_at_period_end || false,
                        metadata: stripeSubscription.metadata || {},
                    };

                    if (user) {
                        subscriptionData.userId = user._id;
                    }

                    if (priceCatalog) {
                        subscriptionData.priceCatalogId = priceCatalog._id;

                        if (priceCatalog.planId) {
                            subscriptionData.planId = priceCatalog.planId.toString();
                        }
                    }

                    if (stripeSubscription.trial_start) {
                        subscriptionData.trialStart = toDateOrNull(
                            stripeSubscription.trial_start,
                        );
                    }

                    if (stripeSubscription.trial_end) {
                        subscriptionData.trialEnd = toDateOrNull(
                            stripeSubscription.trial_end,
                        );
                    }

                    if (stripeSubscription.cancel_at) {
                        subscriptionData.cancelAt = toDateOrNull(
                            stripeSubscription.cancel_at,
                        );
                    }

                    const created = await Subscription.create(subscriptionData);

                    this.logger.info("Elements subscription stored", {
                        subscriptionId: String(created._id),
                    });

                    if (user?.email && created?.userId) {
                        await this.syncSubscriptionToKlaviyo({
                            userId: created.userId,
                            email: user.email,
                            stripeSubscription,
                            subscriptionRecord: created,
                        });
                    }

                    if (
                        user?.email &&
                        user.landingPageName &&
                        priorSubscriptionCount === 0
                    ) {
                        await this.sendSetPasswordEmail(user);
                    }
                } catch (error) {
                    this.logger.error("Elements subscription creation failed", {
                        reason: error.message,
                    });
                }
            }

            async handleElementsSubscriptionUpdated(stripeSubscription) {
                try {
                    const user = stripeSubscription.customer
                        ? await User.findOne({
                            stripeCustomerId: stripeSubscription.customer,
                        })
                        : null;
                    const existing = await Subscription.findOne({
                        stripeSubscriptionId: stripeSubscription.id,
                    });

                    if (!existing) {
                        await this.handleElementsSubscriptionCreated(
                            stripeSubscription,
                        );

                        return;
                    }

                    const previousSubscriptionStatus = existing.status;
                    let fresh = stripeSubscription;

                    try {
                        fresh = await this.stripe.subscriptions.retrieve(
                            stripeSubscription.id,
                        );
                    } catch (error) {
                        this.logger.warn("Elements subscription refresh failed", {
                            reason: error.message,
                        });
                    }

                    existing.status = fresh.status;

                    const newPeriodStart = toDateOrNull(fresh.current_period_start);
                    const newPeriodEnd = toDateOrNull(fresh.current_period_end);

                    if (newPeriodStart) {
                        existing.currentPeriodStart = newPeriodStart;
                    }

                    if (newPeriodEnd) {
                        existing.currentPeriodEnd = newPeriodEnd;
                        existing.nextBillingDate = newPeriodEnd;
                    }

                    if (
                        newPeriodStart &&
                        newPeriodEnd &&
                        Math.abs(newPeriodStart.getTime() - newPeriodEnd.getTime()) <
                            STRIPE_SAME_PERIOD_TOLERANCE_MS
                    ) {
                        try {
                            const invoices = await this.stripe.invoices.list({
                                subscription: stripeSubscription.id,
                                limit: STRIPE_WEBHOOK_LIMITS.LATEST_INVOICE,
                                status: "paid",
                            });
                            const linePeriod =
                                invoices.data?.[0]?.lines?.data?.[0]?.period;

                            if (linePeriod) {
                                const linePeriodStart = toDateOrNull(linePeriod.start);
                                const linePeriodEnd = toDateOrNull(linePeriod.end);

                                if (linePeriodStart) {
                                    existing.currentPeriodStart = linePeriodStart;
                                }

                                if (linePeriodEnd) {
                                    existing.currentPeriodEnd = linePeriodEnd;
                                }
                            }
                        } catch (error) {
                            this.logger.warn("Elements invoice lookup failed", {
                                reason: error.message,
                            });
                        }
                    }

                    existing.cancelAtPeriodEnd = fresh.cancel_at_period_end || false;

                    if (user && !existing.userId) {
                        existing.userId = user._id;
                        existing.isElementsFlow = false;
                    }

                    existing.cancelAt = fresh.cancel_at
                        ? toDateOrNull(fresh.cancel_at)
                        : null;

                    if (fresh.trial_start) {
                        existing.trialStart = toDateOrNull(fresh.trial_start);
                    }

                    if (fresh.trial_end) {
                        existing.trialEnd = toDateOrNull(fresh.trial_end);
                    }

                    existing.metadata = fresh.metadata || existing.metadata;

                    await existing.save();

                    this.logger.info("Elements subscription updated", {
                        subscriptionId: String(existing._id),
                    });

                    if (user?.email && existing.userId) {
                        await this.syncSubscriptionToKlaviyo({
                            userId: existing.userId,
                            email: user.email,
                            stripeSubscription: fresh,
                            subscriptionRecord: existing,
                            previousSubscriptionStatus,
                        });
                    }
                } catch (error) {
                    this.logger.error("Elements subscription update failed", {
                        reason: error.message,
                    });
                }
            }

            async handleElementsSubscriptionDeleted(stripeSubscription) {
                try {
                    const existing = await Subscription.findOne({
                        stripeSubscriptionId: stripeSubscription.id,
                    });

                    if (!existing) {
                        return;
                    }

                    existing.status = STRIPE_SUBSCRIPTION_STATUSES.CANCELED;
                    await existing.save();

                    this.logger.info("Elements subscription canceled", {
                        subscriptionId: String(existing._id),
                    });
                } catch (error) {
                    this.logger.error("Elements subscription deletion failed", {
                        reason: error.message,
                    });
                }
            }

            async handlePaymentMethodAttached(paymentMethod) {
                if (!paymentMethod.customer) {
                    return;
                }

                const user = await User.findOne({
                    stripeCustomerId: paymentMethod.customer,
                });

                if (!user || paymentMethod.id === user.defaultPaymentMethodId) {
                    return;
                }

                // Only auto-default the first card a customer ever attaches. Once
                // they have a default, attaching another card (e.g. saving a
                // second, non-default card from the payment methods list) must
                // not silently switch what one-click pay charges.
                if (user.defaultPaymentMethodId) {
                    return;
                }

                user.defaultPaymentMethodId = paymentMethod.id;
                await user.save();

                try {
                    await this.stripe.customers.update(paymentMethod.customer, {
                        invoice_settings: {
                            default_payment_method: paymentMethod.id,
                        },
                    });
                } catch (error) {
                    this.logger.warn("Stripe customer update failed", {
                        reason: error.message,
                    });
                }

                this.logger.info("Payment method attached", {
                    userId: String(user._id),
                    paymentMethodId: paymentMethod.id,
                });
            }

            async handleChargeRefunded(charge) {
                if (charge.invoice) {
                    try {
                        const invoice = await this.stripe.invoices.retrieve(
                            charge.invoice,
                        );

                        if (!invoice.subscription) {
                            return;
                        }

                        const subscription = await Subscription.findOne({
                            stripeSubscriptionId: invoice.subscription,
                        });

                        if (!subscription) {
                            return;
                        }

                        subscription.billingAmounts.push({
                            amount: -(charge.amount_refunded / STRIPE_AMOUNT_DIVISOR),
                            currency: charge.currency,
                            date: new Date(),
                            invoiceId: charge.invoice,
                            billingReason: STRIPE_BILLING_REASONS.REFUND,
                        });
                        await subscription.save();

                        this.logger.info("Refund recorded on a subscription", {
                            subscriptionId: String(subscription._id),
                        });
                    } catch (error) {
                        this.logger.error("Refund processing failed", {
                            reason: error.message,
                        });
                    }

                    return;
                }

                if (!charge.payment_intent) {
                    return;
                }

                const order = await Order.findOne({
                    stripePaymentIntentId: charge.payment_intent,
                });

                if (!order) {
                    return;
                }

                order.status = charge.refunded
                    ? ORDER_STATUSES.REFUNDED
                    : ORDER_STATUSES.PARTIALLY_REFUNDED;
                order.refundedAmount = charge.amount_refunded / STRIPE_AMOUNT_DIVISOR;
                await order.save();

                this.logger.info("Refund recorded on an order", {
                    orderId: String(order._id),
                    status: order.status,
                });
            }

            async handleInvoicePaid(invoice) {
                if (!invoice.subscription) {
                    return;
                }

                try {
                    await this.stripe.subscriptions.retrieve(invoice.subscription);
                } catch (error) {
                    this.logger.warn("Paid invoice subscription lookup failed", {
                        reason: error.message,
                    });
                }
            }

            async handleCustomerDeleted(customer) {
                const user = await User.findOne({ stripeCustomerId: customer.id });

                if (!user) {
                    return;
                }

                user.stripeCustomerId = null;
                user.defaultPaymentMethodId = null;
                await user.save();

                this.logger.info("Stripe customer cleared from a user", {
                    userId: String(user._id),
                });
            }
        }

        module.exports = { StripeService, isElementsFlow, mergeUtmMetadata };
