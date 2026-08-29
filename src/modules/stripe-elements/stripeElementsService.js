const createHttpError = require("http-errors");
const { config } = require("../../config");
const { realUtmValue } = require("../../common/utils/utmParams");
const {
    STRIPE_ELEMENTS_MESSAGES,
    STRIPE_ELEMENTS_DYNAMIC_MESSAGES,
    STRIPE_ELEMENTS_DEFAULTS,
    STRIPE_ELEMENTS_FLOWS,
    STRIPE_ELEMENTS_ASSESSMENT_KINDS,
    STRIPE_ELEMENTS_ERROR_CODES,
    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES,
    STRIPE_ELEMENTS_PRICE_TYPES,
    LP_SELECT,
} = require("../../constants");
const User = require("../user/userModel");
const Order = require("../stripe/orderModel");
const Subscription = require("../stripe/subscriptionModel");
const PriceCatalog = require("../price-catalog/priceCatalogModel");
const FullAssessment = require("../assessment/fullAssessmentModel");
const AdhdAssessment = require("../adhd-assessment/adhdAssessmentModel");
const EmotionalIntelligenceAssessment = require("../ei-assessment/emotionalIntelligenceAssessmentModel");

class StripeElementsService {
    constructor(logger, stripe, klaviyoSync = null) {
        this.logger = logger;
        this.stripe = stripe;
        this.klaviyoSync = klaviyoSync;
    }

    async syncCancellationToKlaviyo(subscription, localSubscription) {
        if (!this.klaviyoSync?.syncSubscription || !localSubscription?.userId) {
            return;
        }

        try {
            const user = await User.findById(localSubscription.userId)
                .select(LP_SELECT.KLAVIYO_PURCHASE_USER)
                .lean();

            if (user?.email) {
                await this.klaviyoSync.syncSubscription({
                    userId: localSubscription.userId,
                    email: user.email,
                    stripeSubscription: subscription,
                    subscriptionRecord: localSubscription,
                });
            }
        } catch (error) {
            this.logger.error("Klaviyo subscription sync failed", {
                reason: error.message,
            });
        }
    }

    isConfigured() {
        return Boolean(this.stripe);
    }

    getPublishableKey() {
        return config.STRIPE_PUBLIC_KEY || null;
    }

    getDefaultConfig() {
        return {
            recurringPriceId: config.STRIPE_ELEMENTS_PRICE_ID || null,
            trialPriceId: config.STRIPE_ELEMENTS_TRIAL_PRICE_ID || null,
            trialDays:
                parseInt(config.STRIPE_ELEMENTS_TRIAL_DAYS, 10) ||
                STRIPE_ELEMENTS_DEFAULTS.TRIAL_DAYS,
        };
    }

    getConfiguredEnv() {
        return {
            STRIPE_ELEMENTS_PRICE_ID: config.STRIPE_ELEMENTS_PRICE_ID || null,
            STRIPE_ELEMENTS_TRIAL_PRICE_ID:
                config.STRIPE_ELEMENTS_TRIAL_PRICE_ID || null,
            STRIPE_ELEMENTS_TRIAL_DAYS:
                config.STRIPE_ELEMENTS_TRIAL_DAYS || null,
        };
    }

    // Omitted entirely (no "default" placeholder) when there's no real
    // value — a non-landing-page purchase has nothing real to report, and
    // stamping "default" on every purchase's metadata is just noise.
    utmMetadataEntry(key, value) {
        return realUtmValue(value) ? { [key]: String(value) } : {};
    }

    withUtmMetadata(metadata, user) {
        // utmEmail (only ever set by the Klaviyo reminder-link resume flow)
        // overrides the original first-touch utmMedium — no separate
        // "utm_email" metadata field.
        return {
            ...this.utmMetadataEntry("utm_source", user?.utmSource),
            ...this.utmMetadataEntry("utm_campaign", user?.utmCampaign),
            ...this.utmMetadataEntry(
                "utm_medium",
                user?.utmEmail || user?.utmMedium,
            ),
            ...metadata,
        };
    }

    buildCustomerParams(user, metadata) {
        return {
            email: user.email,
            name: user.name || undefined,
            metadata: this.withUtmMetadata(
                { userId: user._id.toString(), ...metadata },
                user,
            ),
        };
    }

    async retrievePrice(priceId) {
        this.logger.info("Reading a stripe price", { priceId });

        return await this.stripe.prices.retrieve(priceId);
    }

    async ensureSubscriptionCustomer(user) {
        this.logger.info("Resolving the stripe customer of a user", {
            userId: String(user._id),
            stripeCustomerId: user.stripeCustomerId || null,
        });

        if (!user.stripeCustomerId) {
            return await this.createSubscriptionCustomer(user, {
                createdAt: new Date().toISOString(),
            });
        }

        try {
            await this.stripe.customers.retrieve(user.stripeCustomerId);

            return user.stripeCustomerId;
        } catch (error) {
            if (error.code !== STRIPE_ELEMENTS_ERROR_CODES.RESOURCE_MISSING) {
                throw error;
            }

            this.logger.warn("Stripe customer is missing, recreating it", {
                userId: String(user._id),
                stripeCustomerId: user.stripeCustomerId,
            });

            return await this.createSubscriptionCustomer(user, {
                recreatedAt: new Date().toISOString(),
            });
        }
    }

    async createSubscriptionCustomer(user, timestamps) {
        const customer = await this.stripe.customers.create(
            this.buildCustomerParams(user, {
                source: STRIPE_ELEMENTS_FLOWS.CUSTOMER_SOURCE,
                ...timestamps,
            }),
        );

        user.stripeCustomerId = customer.id;
        await user.save();

        this.logger.info("Stripe customer created for the subscription flow", {
            userId: String(user._id),
            stripeCustomerId: customer.id,
        });

        return customer.id;
    }

    async createSetupIntent({
        user,
        customerId,
        recurringPriceId,
        withTrial,
        trialPriceId,
        trialDays,
    }) {
        this.logger.info("Creating a stripe setup intent", {
            userId: String(user._id),
            customerId,
            recurringPriceId,
        });

        const setupIntent = await this.stripe.setupIntents.create({
            customer: customerId,
            payment_method_types: ["card"],
            usage: "off_session",
            metadata: this.withUtmMetadata(
                {
                    flow: STRIPE_ELEMENTS_FLOWS.ELEMENTS,
                    userId: user._id.toString(),
                    recurringPriceId,
                    withTrial: String(withTrial),
                    trialPriceId: withTrial ? trialPriceId : "",
                    trialDays: String(trialDays),
                    createdAt: new Date().toISOString(),
                },
                user,
            ),
        });

        this.logger.info("Stripe setup intent created", {
            userId: String(user._id),
            setupIntentId: setupIntent.id,
        });

        return setupIntent;
    }

    async retrieveSetupIntent(setupIntentId) {
        this.logger.info("Reading a stripe setup intent", { setupIntentId });

        return await this.stripe.setupIntents.retrieve(setupIntentId);
    }

    async saveDefaultPaymentMethod(user, customerId, paymentMethodId) {
        this.logger.info("Saving the default payment method of a customer", {
            userId: String(user._id),
            customerId,
            paymentMethodId,
        });

        await this.stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
        });

        user.defaultPaymentMethodId = paymentMethodId;
        await user.save();

        this.logger.info("Default payment method saved", {
            userId: String(user._id),
            paymentMethodId,
        });
    }

    async createSubscriptionForUser({
        user,
        customerId,
        paymentMethodId,
        setupIntentId,
        recurringPriceId,
        withTrial,
        trialPriceId,
        trialDays,
    }) {
        this.logger.info("Creating a stripe subscription", {
            userId: String(user._id),
            customerId,
            recurringPriceId,
            withTrial: Boolean(withTrial),
        });

        if (withTrial && trialPriceId) {
            const trialPrice = await this.retrievePrice(trialPriceId);

            await this.stripe.invoiceItems.create({
                customer: customerId,
                amount: trialPrice.unit_amount,
                currency: trialPrice.currency,
                description:
                    STRIPE_ELEMENTS_DYNAMIC_MESSAGES.trialAccessDescription(
                        trialDays,
                    ),
                metadata: this.withUtmMetadata(
                    {
                        type: STRIPE_ELEMENTS_FLOWS.TRIAL_FEE,
                        trialDays: String(trialDays),
                        trialPriceId,
                    },
                    user,
                ),
            });

            const subscription = await this.stripe.subscriptions.create({
                customer: customerId,
                items: [{ price: recurringPriceId }],
                default_payment_method: paymentMethodId,
                trial_period_days: trialDays,
                payment_behavior: "default_incomplete",
                payment_settings: {
                    payment_method_types: ["card"],
                    save_default_payment_method: "on_subscription",
                },
                expand: ["latest_invoice.payment_intent"],
                metadata: this.withUtmMetadata(
                    {
                        flow: STRIPE_ELEMENTS_FLOWS.ELEMENTS_TRIAL,
                        userId: user._id.toString(),
                        setupIntentId,
                        trialPriceId,
                        trialDays: String(trialDays),
                        createdAt: new Date().toISOString(),
                    },
                    user,
                ),
            });

            this.logger.info("Stripe trial subscription created", {
                userId: String(user._id),
                subscriptionId: subscription.id,
                status: subscription.status,
            });

            return subscription;
        }

        const subscription = await this.stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: recurringPriceId }],
            default_payment_method: paymentMethodId,
            payment_behavior: "default_incomplete",
            payment_settings: {
                payment_method_types: ["card"],
                save_default_payment_method: "on_subscription",
            },
            expand: ["latest_invoice.payment_intent"],
            metadata: this.withUtmMetadata(
                {
                    flow: STRIPE_ELEMENTS_FLOWS.ELEMENTS,
                    userId: user._id.toString(),
                    setupIntentId,
                    createdAt: new Date().toISOString(),
                },
                user,
            ),
        });

        this.logger.info("Stripe subscription created", {
            userId: String(user._id),
            subscriptionId: subscription.id,
            status: subscription.status,
        });

        return subscription;
    }

    async resolveSubscriptionPayment(
        subscription,
        customerId,
        paymentMethodId,
    ) {
        this.logger.info("Resolving the payment intent of a subscription", {
            subscriptionId: subscription.id,
            customerId,
        });

        let paymentIntent = subscription.latest_invoice?.payment_intent;
        let clientSecret = null;
        let paymentIntentId = null;
        let paymentStatus = null;

        if (typeof paymentIntent === "string") {
            paymentIntent =
                await this.stripe.paymentIntents.retrieve(paymentIntent);
        }

        if (paymentIntent && typeof paymentIntent === "object") {
            clientSecret = paymentIntent.client_secret;
            paymentIntentId = paymentIntent.id;
            paymentStatus = paymentIntent.status;
        }

        if (!clientSecret && subscription.latest_invoice) {
            const invoiceId =
                typeof subscription.latest_invoice === "string"
                    ? subscription.latest_invoice
                    : subscription.latest_invoice.id;

            const invoice = await this.stripe.invoices.retrieve(invoiceId, {
                expand: ["payment_intent"],
            });

            if (invoice.payment_intent) {
                paymentIntent = invoice.payment_intent;

                if (typeof paymentIntent === "string") {
                    paymentIntent =
                        await this.stripe.paymentIntents.retrieve(
                            paymentIntent,
                        );
                }

                clientSecret = paymentIntent.client_secret;
                paymentIntentId = paymentIntent.id;
                paymentStatus = paymentIntent.status;
            }
        }

        if (!clientSecret) {
            const paymentIntents = await this.stripe.paymentIntents.list({
                customer: customerId,
                limit: STRIPE_ELEMENTS_DEFAULTS.PAYMENT_INTENT_LIST_LIMIT,
            });

            for (const pending of paymentIntents.data) {
                const isPending =
                    pending.status ===
                        STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_PAYMENT_METHOD ||
                    pending.status ===
                        STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_CONFIRMATION ||
                    pending.status ===
                        STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_ACTION;

                if (!isPending) {
                    continue;
                }

                if (
                    pending.status !==
                    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES.REQUIRES_PAYMENT_METHOD
                ) {
                    clientSecret = pending.client_secret;
                    paymentIntentId = pending.id;
                    paymentStatus = pending.status;
                    break;
                }

                try {
                    const confirmed = await this.stripe.paymentIntents.confirm(
                        pending.id,
                        { payment_method: paymentMethodId },
                    );

                    clientSecret = confirmed.client_secret;
                    paymentIntentId = confirmed.id;
                    paymentStatus = confirmed.status;
                    break;
                } catch (error) {
                    this.logger.warn("Confirming a payment intent failed", {
                        subscriptionId: subscription.id,
                        paymentIntentId: pending.id,
                        reason: error.message,
                    });

                    if (error.payment_intent) {
                        clientSecret = error.payment_intent.client_secret;
                        paymentIntentId = error.payment_intent.id;
                        paymentStatus = error.payment_intent.status;
                        break;
                    }
                }
            }
        }

        this.logger.info("Subscription payment intent resolved", {
            subscriptionId: subscription.id,
            paymentIntentId,
            paymentStatus,
        });

        return { clientSecret, paymentIntentId, paymentStatus };
    }

    async retrieveSubscription(subscriptionId, options) {
        this.logger.info("Reading a stripe subscription", { subscriptionId });

        return options
            ? await this.stripe.subscriptions.retrieve(subscriptionId, options)
            : await this.stripe.subscriptions.retrieve(subscriptionId);
    }

    async cancelSubscription(subscriptionId, metadata, cancelImmediately) {
        this.logger.info("Cancelling a stripe subscription", {
            subscriptionId,
            cancelImmediately: Boolean(cancelImmediately),
        });

        if (cancelImmediately) {
            await this.stripe.subscriptions.update(subscriptionId, {
                metadata,
            });

            const cancelled =
                await this.stripe.subscriptions.cancel(subscriptionId);

            this.logger.info("Stripe subscription cancelled", {
                subscriptionId,
                status: cancelled.status,
            });

            return cancelled;
        }

        const updated = await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
            metadata,
        });

        this.logger.info("Stripe subscription set to cancel at period end", {
            subscriptionId,
            status: updated.status,
        });

        return updated;
    }

    async saveSubscriptionCancellation({
        subscriptionId,
        subscription,
        cancelReason,
        wouldHaveStayedIfOffered,
        metadata,
    }) {
        this.logger.info("Saving the cancellation survey of a subscription", {
            subscriptionId,
        });

        const localSubscription = await Subscription.findOneAndUpdate(
            { stripeSubscriptionId: subscriptionId },
            {
                $set: {
                    cancelReason,
                    wouldHaveStayedIfOffered,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    status: subscription.status,
                    cancelAt: subscription.cancel_at
                        ? new Date(subscription.cancel_at * 1000)
                        : null,
                    metadata,
                },
            },
            { new: true },
        );

        this.logger.info("Cancellation survey saved", {
            subscriptionId,
            found: Boolean(localSubscription),
        });

        await this.syncCancellationToKlaviyo(subscription, localSubscription);

        return localSubscription;
    }

    async findUserSubscriptions(userId) {
        this.logger.info("Reading the subscriptions of a user", {
            userId: String(userId),
        });

        return await Subscription.find({ userId })
            .sort({ createdAt: -1 })
            .lean();
    }

    async listStripeSubscriptions(customerId) {
        this.logger.info("Listing the stripe subscriptions of a customer", {
            customerId,
        });

        return await this.stripe.subscriptions.list({
            customer: customerId,
            limit: STRIPE_ELEMENTS_DEFAULTS.STRIPE_SUBSCRIPTION_LIMIT,
            expand: ["data.default_payment_method"],
        });
    }

    async resolveAssessmentPaymentContext(assessmentId, priceCatalogId) {
        this.logger.info("Resolving the payment context of an assessment", {
            assessmentId: String(assessmentId),
            priceCatalogId: priceCatalogId ? String(priceCatalogId) : null,
        });

        const fullAssessment =
            await FullAssessment.findById(assessmentId).lean();

        if (fullAssessment) {
            if (!fullAssessment.stripeProductId) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.ASSESSMENT_WITHOUT_PRODUCT,
                );
            }

            return {
                assessmentKind: STRIPE_ELEMENTS_ASSESSMENT_KINDS.FULL,
                orderAssessmentId: fullAssessment._id,
                assessmentDisplayName:
                    fullAssessment.mainCategory ||
                    fullAssessment.title ||
                    fullAssessment.name ||
                    STRIPE_ELEMENTS_DEFAULTS.FULL_ASSESSMENT_NAME,
                stripeProductId: fullAssessment.stripeProductId,
            };
        }

        const adhdAssessment =
            await AdhdAssessment.findById(assessmentId).lean();

        if (adhdAssessment) {
            const stripeProductId = await this.resolveAssessmentProductId({
                assessment: adhdAssessment,
                priceCatalogId,
                mismatchMessage: STRIPE_ELEMENTS_MESSAGES.ADHD_PRICE_MISMATCH,
                unresolvedMessage:
                    STRIPE_ELEMENTS_MESSAGES.ADHD_PRODUCT_UNRESOLVED,
            });

            return {
                assessmentKind: STRIPE_ELEMENTS_ASSESSMENT_KINDS.ADHD,
                orderAssessmentId: adhdAssessment._id,
                assessmentDisplayName:
                    adhdAssessment.title ||
                    STRIPE_ELEMENTS_DEFAULTS.ADHD_ASSESSMENT_NAME,
                stripeProductId,
            };
        }

        const eiAssessment =
            await EmotionalIntelligenceAssessment.findById(assessmentId).lean();

        if (!eiAssessment) {
            throw createHttpError(
                404,
                STRIPE_ELEMENTS_MESSAGES.ASSESSMENT_NOT_FOUND,
            );
        }

        const stripeProductId = await this.resolveAssessmentProductId({
            assessment: eiAssessment,
            priceCatalogId,
            mismatchMessage: STRIPE_ELEMENTS_MESSAGES.EI_PRICE_MISMATCH,
            unresolvedMessage: STRIPE_ELEMENTS_MESSAGES.EI_PRODUCT_UNRESOLVED,
        });

        return {
            assessmentKind:
                STRIPE_ELEMENTS_ASSESSMENT_KINDS.EMOTIONAL_INTELLIGENCE,
            orderAssessmentId: eiAssessment._id,
            assessmentDisplayName:
                eiAssessment.title ||
                STRIPE_ELEMENTS_DEFAULTS.EI_ASSESSMENT_NAME,
            stripeProductId,
        };
    }

    async resolveAssessmentProductId({
        assessment,
        priceCatalogId,
        mismatchMessage,
        unresolvedMessage,
    }) {
        const basePrice = assessment.priceCatalogId
            ? await PriceCatalog.findById(assessment.priceCatalogId).lean()
            : null;

        let stripeProductId = basePrice?.stripeProductId;

        if (priceCatalogId) {
            const picked = await PriceCatalog.findById(priceCatalogId).lean();

            if (
                !picked ||
                picked.type !== STRIPE_ELEMENTS_PRICE_TYPES.ONE_TIME ||
                !picked.active
            ) {
                throw createHttpError(
                    404,
                    STRIPE_ELEMENTS_MESSAGES.PRICE_NOT_FOUND,
                );
            }

            if (stripeProductId && picked.stripeProductId !== stripeProductId) {
                throw createHttpError(400, mismatchMessage);
            }

            stripeProductId = picked.stripeProductId;
        }

        if (!stripeProductId) {
            throw createHttpError(400, unresolvedMessage);
        }

        return stripeProductId;
    }

    async resolveActiveOneTimePriceCatalog(stripeProductId, priceCatalogId) {
        this.logger.info("Resolving the active one time price of a product", {
            stripeProductId,
            priceCatalogId: priceCatalogId ? String(priceCatalogId) : null,
        });

        const queryBase = {
            stripeProductId,
            type: STRIPE_ELEMENTS_PRICE_TYPES.ONE_TIME,
            active: true,
        };

        if (priceCatalogId) {
            const price = await PriceCatalog.findOne({
                _id: priceCatalogId,
                ...queryBase,
            }).lean();

            if (!price) {
                throw createHttpError(
                    404,
                    STRIPE_ELEMENTS_MESSAGES.PRICE_NOT_FOUND,
                );
            }

            return price;
        }

        const defaultPrice = await PriceCatalog.findOne({
            ...queryBase,
            default: true,
        }).lean();

        const price =
            defaultPrice ||
            (await PriceCatalog.findOne(queryBase)
                .sort({ createdAt: -1 })
                .lean());

        if (!price) {
            throw createHttpError(
                404,
                STRIPE_ELEMENTS_MESSAGES.NO_ACTIVE_PRICE,
            );
        }

        return price;
    }

    async resolveGenericChargeAmount({
        priceCatalogId,
        amount,
        currency,
        productName,
    }) {
        this.logger.info("Resolving a generic charge amount", {
            priceCatalogId: priceCatalogId ? String(priceCatalogId) : null,
            amount,
        });

        if (priceCatalogId) {
            const price = await PriceCatalog.findOne({
                _id: priceCatalogId,
                active: true,
            }).lean();

            if (!price) {
                throw createHttpError(
                    404,
                    STRIPE_ELEMENTS_MESSAGES.PRICE_CATALOG_NOT_FOUND,
                );
            }

            if (
                !price.unitAmount ||
                price.unitAmount < STRIPE_ELEMENTS_DEFAULTS.MINIMUM_AMOUNT
            ) {
                throw createHttpError(
                    400,
                    STRIPE_ELEMENTS_MESSAGES.BELOW_STRIPE_MINIMUM,
                );
            }

            return {
                amountCents: price.unitAmount,
                currency: (
                    price.currency || STRIPE_ELEMENTS_DEFAULTS.CURRENCY
                ).toLowerCase(),
                productName:
                    productName || STRIPE_ELEMENTS_DEFAULTS.PRODUCT_NAME,
                priceCatalogId: price._id,
            };
        }

        const amountCents = Math.round(Number(amount));

        if (
            !Number.isInteger(amountCents) ||
            amountCents < STRIPE_ELEMENTS_DEFAULTS.MINIMUM_AMOUNT
        ) {
            throw createHttpError(400, STRIPE_ELEMENTS_MESSAGES.AMOUNT_INVALID);
        }

        return {
            amountCents,
            currency: (
                currency || STRIPE_ELEMENTS_DEFAULTS.CURRENCY
            ).toLowerCase(),
            productName: productName || STRIPE_ELEMENTS_DEFAULTS.PRODUCT_NAME,
            priceCatalogId: null,
        };
    }

    async getOrCreatePaymentCustomer(user) {
        if (user.stripeCustomerId) {
            return user.stripeCustomerId;
        }

        this.logger.info("Creating a stripe customer for a payment", {
            userId: String(user._id),
        });

        const customer = await this.stripe.customers.create(
            this.buildCustomerParams(user, {
                source: STRIPE_ELEMENTS_FLOWS.PAYMENT_CUSTOMER_SOURCE,
                createdAt: new Date().toISOString(),
            }),
        );

        await User.findByIdAndUpdate(user._id, {
            stripeCustomerId: customer.id,
        });

        this.logger.info("Stripe customer created for the payment flow", {
            userId: String(user._id),
            stripeCustomerId: customer.id,
        });

        return customer.id;
    }

    async createOrder(fields) {
        this.logger.info("Creating an order", {
            userId: String(fields.userId),
            unitAmount: fields.unitAmount,
        });

        const order = await Order.create(fields);

        this.logger.info("Order created", { orderId: String(order._id) });

        return order;
    }

    async saveOrderPaymentIntent(order, paymentIntentId, status) {
        order.stripePaymentIntentId = paymentIntentId;

        if (status) {
            order.status = status;
        }

        await order.save();

        this.logger.info("Order linked to a payment intent", {
            orderId: String(order._id),
            paymentIntentId,
            status: order.status,
        });

        return order;
    }

    async createAssessmentPaymentIntent({
        user,
        order,
        customerId,
        price,
        context,
    }) {
        this.logger.info("Creating a stripe payment intent for an assessment", {
            userId: String(user._id),
            orderId: String(order._id),
        });

        return await this.stripe.paymentIntents.create({
            amount: price.unitAmount,
            currency: price.currency.toLowerCase(),
            customer: customerId,
            description: STRIPE_ELEMENTS_DYNAMIC_MESSAGES.assessmentDescription(
                context.assessmentDisplayName,
            ),
            metadata: this.withUtmMetadata(
                {
                    orderId: String(order._id),
                    userId: String(user._id),
                    assessmentId: String(context.orderAssessmentId),
                    assessmentKind: context.assessmentKind,
                    priceCatalogId: String(price._id),
                    flow: STRIPE_ELEMENTS_FLOWS.PAYMENT,
                },
                user,
            ),
            setup_future_usage: "off_session",
            payment_method_types: ["card"],
            payment_method_options: {
                card: { request_three_d_secure: "automatic" },
            },
        });
    }

    async createQuickPayPaymentIntent({
        user,
        order,
        price,
        assessment,
        paymentMethodId,
    }) {
        this.logger.info("Creating a stripe quick pay payment intent", {
            userId: String(user._id),
            orderId: String(order._id),
        });

        return await this.stripe.paymentIntents.create({
            amount: price.unitAmount,
            currency: price.currency.toLowerCase(),
            customer: user.stripeCustomerId,
            payment_method: paymentMethodId,
            confirm: true,
            off_session: true,
            description: STRIPE_ELEMENTS_DYNAMIC_MESSAGES.assessmentDescription(
                assessment.mainCategory ||
                    assessment.name ||
                    STRIPE_ELEMENTS_DEFAULTS.FULL_ASSESSMENT_NAME,
            ),
            metadata: this.withUtmMetadata(
                {
                    orderId: String(order._id),
                    userId: String(user._id),
                    assessmentId: String(assessment._id),
                    priceCatalogId: String(price._id),
                    flow: STRIPE_ELEMENTS_FLOWS.QUICK_PAY,
                },
                user,
            ),
            payment_method_types: ["card"],
        });
    }

    async createGenericPaymentIntent({
        customerId,
        charge,
        description,
        metadata,
        paymentMethodId,
    }) {
        this.logger.info("Creating a generic stripe payment intent", {
            customerId,
            amount: charge.amountCents,
            oneClick: Boolean(paymentMethodId),
        });

        if (paymentMethodId) {
            return await this.stripe.paymentIntents.create({
                amount: charge.amountCents,
                currency: charge.currency,
                customer: customerId,
                payment_method: paymentMethodId,
                confirm: true,
                off_session: true,
                description,
                metadata,
                payment_method_types: ["card"],
            });
        }

        return await this.stripe.paymentIntents.create({
            amount: charge.amountCents,
            currency: charge.currency,
            customer: customerId,
            description,
            metadata,
            setup_future_usage: "off_session",
            payment_method_types: ["card"],
            payment_method_options: {
                card: { request_three_d_secure: "automatic" },
            },
        });
    }

    async retrievePaymentIntent(paymentIntentId) {
        this.logger.info("Reading a stripe payment intent", {
            paymentIntentId,
        });

        return await this.stripe.paymentIntents.retrieve(paymentIntentId);
    }

    async findOrderWithAssessment(orderId) {
        this.logger.info("Reading an order", { orderId: String(orderId) });

        return await Order.findById(orderId)
            .populate("assessmentId", "mainCategory name")
            .lean();
    }

    async updateOrderStatus(orderId, status) {
        this.logger.info("Updating the status of an order", {
            orderId: String(orderId),
            status,
        });

        await Order.findByIdAndUpdate(orderId, { status });
    }

    async findUserOrders(userId) {
        this.logger.info("Reading the orders of a user", {
            userId: String(userId),
        });

        return await Order.find({ userId })
            .populate("assessmentId", "mainCategory name")
            .populate("priceCatalogId", "unitAmount currency")
            .sort({ createdAt: -1 })
            .lean();
    }

    async setUserDefaultPaymentMethod(userId, paymentMethodId) {
        this.logger.info("Storing the default payment method of a user", {
            userId: String(userId),
            paymentMethodId,
        });

        await User.findByIdAndUpdate(userId, {
            defaultPaymentMethodId: paymentMethodId,
        });
    }

    async findFullAssessment(assessmentId) {
        this.logger.info("Reading a full assessment", {
            assessmentId: String(assessmentId),
        });

        return await FullAssessment.findById(assessmentId).lean();
    }

    async findQuickPayPrice(stripeProductId, priceCatalogId) {
        this.logger.info("Reading the quick pay price of a product", {
            stripeProductId,
            priceCatalogId: priceCatalogId ? String(priceCatalogId) : null,
        });

        if (priceCatalogId) {
            return await PriceCatalog.findOne({
                _id: priceCatalogId,
                stripeProductId,
                type: STRIPE_ELEMENTS_PRICE_TYPES.ONE_TIME,
                active: true,
            }).lean();
        }

        const defaultPrice = await PriceCatalog.findOne({
            stripeProductId,
            type: STRIPE_ELEMENTS_PRICE_TYPES.ONE_TIME,
            active: true,
            default: true,
        }).lean();

        if (defaultPrice) {
            return defaultPrice;
        }

        return await PriceCatalog.findOne({
            stripeProductId,
            type: STRIPE_ELEMENTS_PRICE_TYPES.ONE_TIME,
            active: true,
        })
            .sort({ createdAt: -1 })
            .lean();
    }
}

module.exports = { StripeElementsService };
