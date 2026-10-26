const crypto = require("crypto");
const { config } = require("../../config");
const {
    realUtmValue,
    parseUtmParams,
    persistUtmDefaults,
} = require("../../common/utils/utmParams");
const {
    KLAVIYO_EVENTS,
    KLAVIYO_MESSAGES,
    LP_ASSESSMENT_STATUS,
    LP_FUNNEL_STAGES,
    LP_KLAVIYO_EVENT_IDS,
    LP_KLAVIYO_PROPERTIES,
    LP_KLAVIYO_PROPERTY_BUILDERS,
    LP_KLAVIYO_PURCHASE_PROPERTIES,
    LP_KLAVIYO_SUBSCRIPTION_PROPERTIES,
    LP_KLAVIYO_SUBSCRIPTION_STATUS_MAP,
    LP_KLAVIYO_SYNC_REASONS,
    LP_LEADERBOARD_RANK_FIELDS,
    LP_RESUME_URL,
    LP_SELECT,
    LP_STRIPE_PRICE_EXPAND,
    LP_WOULD_HAVE_STAYED_SEPARATOR,
    ORDER_STATUSES,
    STRIPE_CADENCES,
    STRIPE_DURATION_INTERVALS,
    STRIPE_SUBSCRIPTION_STATUSES,
} = require("../../constants");
const FullAssessment = require("../assessment/fullAssessmentModel");
const Order = require("../stripe/orderModel");
const User = require("../user/userModel");

const toPlainObject = (value) => (value?.toObject ? value.toObject() : value);

const toISOStringOrUndefined = (value) => {
    if (!value) {
        return undefined;
    }

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const trimmedOrUndefined = (value) =>
    value != null && String(value).trim() !== ""
        ? String(value).trim()
        : undefined;

// Keep the original acquisition medium separate from email attribution.
const buildKlaviyoUtmProperties = (record) => {
    if (!record) {
        return {};
    }

    const out = {};
    const source = trimmedOrUndefined(record.utmSource);
    const campaign = trimmedOrUndefined(record.utmCampaign);
    const medium = trimmedOrUndefined(record.utmMedium);
    const email = trimmedOrUndefined(record.utmEmail);
    const flowId = trimmedOrUndefined(record.flowId);

    if (source !== undefined) {
        out[LP_KLAVIYO_PROPERTIES.SOURCE] = source;
    }

    if (campaign !== undefined) {
        out[LP_KLAVIYO_PROPERTIES.CAMPAIGN] = campaign;
    }

    if (medium !== undefined) {
        out[LP_KLAVIYO_PROPERTIES.MEDIUM] = medium;
    }

    if (email !== undefined) {
        out.utm_email = email;
    }
    if (flowId !== undefined) out.flow_id = flowId;

    return out;
};

const funnelStage = (hook) => {
    if (!hook) {
        return LP_FUNNEL_STAGES.LANDING;
    }

    if (hook.paymentCompleted) {
        return LP_FUNNEL_STAGES.COMPLETED;
    }

    if (!hook.email) {
        return LP_FUNNEL_STAGES.LANDING;
    }

    if (hook.assessmentStatus !== LP_ASSESSMENT_STATUS.COMPLETED) {
        return LP_FUNNEL_STAGES.QUIZ;
    }

    if (!hook.name) {
        return LP_FUNNEL_STAGES.DETAILS;
    }

    return LP_FUNNEL_STAGES.CHECKOUT;
};

const fromStripeSecondsToISO = (seconds) => {
    if (!seconds) {
        return undefined;
    }

    const value = typeof seconds === "number" ? seconds : Number(seconds);

    return Number.isFinite(value)
        ? new Date(value * 1000).toISOString()
        : undefined;
};

const toStripeSeconds = (value) =>
    value ? Math.floor(new Date(value).getTime() / 1000) : undefined;

const subscriptionPriceId = (stripeSubscription) =>
    stripeSubscription?.items?.data?.[0]?.price?.id ||
    stripeSubscription?.plan?.id ||
    stripeSubscription?.items?.data?.[0]?.plan?.id ||
    null;

const subscriptionInterval = (stripeSubscription) => {
    const interval =
        stripeSubscription?.items?.data?.[0]?.price?.recurring?.interval ||
        stripeSubscription?.plan?.interval ||
        stripeSubscription?.plan?.interval_count;

    if (interval === STRIPE_DURATION_INTERVALS.yearly) {
        return STRIPE_CADENCES.YEARLY;
    }

    if (interval === STRIPE_DURATION_INTERVALS.monthly) {
        return STRIPE_CADENCES.MONTHLY;
    }

    return interval || undefined;
};

const stripeSubscriptionFromRecord = (subscriptionRecord) => {
    if (!subscriptionRecord) {
        return null;
    }

    const interval = STRIPE_DURATION_INTERVALS[subscriptionRecord.planDuration];

    return {
        id: subscriptionRecord.stripeSubscriptionId,
        status: subscriptionRecord.status,
        current_period_start: toStripeSeconds(
            subscriptionRecord.currentPeriodStart,
        ),
        current_period_end: toStripeSeconds(
            subscriptionRecord.currentPeriodEnd,
        ),
        trial_start: toStripeSeconds(subscriptionRecord.trialStart),
        trial_end: toStripeSeconds(subscriptionRecord.trialEnd),
        plan: interval ? { interval } : undefined,
        items: { data: [{ price: { id: null } }] },
    };
};

const cancellationSurveyProperties = (subscriptionRecord) => {
    const record = toPlainObject(subscriptionRecord);

    if (!record) {
        return {};
    }

    const out = {};
    const cancelReason = trimmedOrUndefined(record.cancelReason);

    if (cancelReason !== undefined) {
        out[LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.CANCEL_REASON] = cancelReason;
    }

    const stayed = Array.isArray(record.wouldHaveStayedIfOffered)
        ? record.wouldHaveStayedIfOffered
              .map((answer) => String(answer).trim())
              .filter(Boolean)
              .join(LP_WOULD_HAVE_STAYED_SEPARATOR)
        : "";

    if (stayed) {
        out[LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.WOULD_HAVE_STAYED] = stayed;
    }

    return out;
};

const buildResumeUrl = (uuid) => {
    const base = config.LANDING_PAGE_URL;

    if (!base || !uuid) {
        return undefined;
    }

    return `${base.replace(/\/+$/, "")}${LP_RESUME_URL.PATH}?${LP_RESUME_URL.UUID_PARAM}=${encodeURIComponent(uuid)}&${LP_RESUME_URL.UTM_MEDIUM_PARAM}=${LP_RESUME_URL.UTM_MEDIUM_VALUE}`;
};

// No expiry: this token stays valid until it's used once (see
// authController#resetPasswordWithToken), unlike the 5-minute JWT the
// regular "forgot password" email flow issues.
const buildPasswordResetUrl = (token) => {
    const base = config.FRONTEND_URL;

    if (!base || !token) {
        return undefined;
    }

    return `${base.replace(/\/+$/, "")}/forgot-password/${token}`;
};

const hashResetToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

class KlaviyoSyncService {
    constructor(
        logger,
        klaviyoService,
        assessmentService,
        leaderboardService,
        stripe = null,
    ) {
        this.logger = logger;
        this.klaviyoService = klaviyoService;
        this.assessmentService = assessmentService;
        this.leaderboardService = leaderboardService;
        this.stripe = stripe;
    }

    funnelStage(hook) {
        return funnelStage(hook);
    }

    buildResumeUrl(uuid) {
        return buildResumeUrl(uuid);
    }

    async resolveMainCategory(quickMiniAssessmentId) {
        if (!quickMiniAssessmentId) {
            return undefined;
        }

        const mini = await this.assessmentService.findQuickMiniById(
            quickMiniAssessmentId,
            LP_SELECT.FULL_ASSESSMENT_REF,
        );

        if (!mini?.fullAssessment) {
            return undefined;
        }

        const full = await this.assessmentService.findFullAssessmentById(
            mini.fullAssessment,
            LP_SELECT.MAIN_CATEGORY,
        );

        return full?.mainCategory;
    }

    async resolveLeaderboardRanks(userId) {
        if (!userId) {
            return {};
        }

        const leaderboard = await this.leaderboardService.findByUserId(userId);

        if (!leaderboard) {
            return {};
        }

        return Object.fromEntries(
            LP_LEADERBOARD_RANK_FIELDS.map((field) => [
                field,
                leaderboard[field],
            ]),
        );
    }

    buildEvents({ hookObj, prevObj, email, mainCategory }) {
        const events = [];

        if (!prevObj?.email && Boolean(email)) {
            events.push({
                metricName: KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_CAPTURED,
                uniqueId: `${hookObj.uuid}:${LP_KLAVIYO_EVENT_IDS.EMAIL_CAPTURED}`,
                properties: {
                    [LP_KLAVIYO_PROPERTIES.LANDING_PAGE_NAME]:
                        hookObj.landingPageName ?? undefined,
                    ...buildKlaviyoUtmProperties(hookObj),
                },
            });
        }

        if (!prevObj?.paymentInitiated && Boolean(hookObj.paymentInitiated)) {
            events.push({
                metricName: KLAVIYO_EVENTS.LANDING_PAGE_PAYMENT_INITIATED,
                uniqueId: `${hookObj.uuid}:${LP_KLAVIYO_EVENT_IDS.PAYMENT_INITIATED}`,
                properties: {
                    [LP_KLAVIYO_PROPERTIES.LANDING_PAGE_NAME]:
                        hookObj.landingPageName ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.QUESTION_NUMBER]:
                        hookObj.questionNumber ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY]: mainCategory,
                },
            });
        }

        if (!prevObj?.paymentCompleted && Boolean(hookObj.paymentCompleted)) {
            events.push({
                metricName: KLAVIYO_EVENTS.LANDING_PAGE_PAYMENT_COMPLETED,
                uniqueId: `${hookObj.uuid}:${LP_KLAVIYO_EVENT_IDS.PAYMENT_COMPLETED}`,
                properties: {
                    [LP_KLAVIYO_PROPERTIES.LANDING_PAGE_NAME]:
                        hookObj.landingPageName ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.QUESTION_NUMBER]:
                        hookObj.questionNumber ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY]: mainCategory,
                },
            });
        }

        // Came back through the reminder email's resume link — that's the
        // only place utmEmail is ever set to this exact value — so fire the
        // email-flow variants on top of the regular payment events above.
        const cameBackFromEmail =
            realUtmValue(hookObj.utmEmail) === LP_RESUME_URL.UTM_MEDIUM_VALUE;

        if (
            cameBackFromEmail &&
            !prevObj?.paymentInitiated &&
            Boolean(hookObj.paymentInitiated)
        ) {
            events.push({
                metricName:
                    KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_FLOW_PAYMENT_INITIATED,
                uniqueId: `${hookObj.uuid}:${LP_KLAVIYO_EVENT_IDS.EMAIL_FLOW_PAYMENT_INITIATED}`,
                properties: {
                    [LP_KLAVIYO_PROPERTIES.LANDING_PAGE_NAME]:
                        hookObj.landingPageName ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.QUESTION_NUMBER]:
                        hookObj.questionNumber ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY]: mainCategory,
                    ...buildKlaviyoUtmProperties(hookObj),
                },
            });
        }

        if (
            cameBackFromEmail &&
            !prevObj?.paymentCompleted &&
            Boolean(hookObj.paymentCompleted)
        ) {
            events.push({
                metricName:
                    KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_FLOW_PAYMENT_COMPLETED,
                uniqueId: `${hookObj.uuid}:${LP_KLAVIYO_EVENT_IDS.EMAIL_FLOW_PAYMENT_COMPLETED}`,
                properties: {
                    [LP_KLAVIYO_PROPERTIES.LANDING_PAGE_NAME]:
                        hookObj.landingPageName ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.QUESTION_NUMBER]:
                        hookObj.questionNumber ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY]: mainCategory,
                    ...buildKlaviyoUtmProperties(hookObj),
                },
            });
        }

        const prevAssessmentCompleted =
            prevObj?.assessmentStatus === LP_ASSESSMENT_STATUS.COMPLETED;
        const nowAssessmentCompleted =
            hookObj?.assessmentStatus === LP_ASSESSMENT_STATUS.COMPLETED;

        if (!prevAssessmentCompleted && nowAssessmentCompleted) {
            events.push({
                metricName: KLAVIYO_EVENTS.LANDING_PAGE_ASSESSMENT_COMPLETED,
                uniqueId: `${hookObj.uuid}:${LP_KLAVIYO_EVENT_IDS.ASSESSMENT_COMPLETED}`,
                properties: {
                    [LP_KLAVIYO_PROPERTIES.QUESTION_NUMBER]:
                        hookObj.questionNumber ?? undefined,
                    [LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY]: mainCategory,
                    [LP_KLAVIYO_PROPERTIES.EVENT_ASSESSMENT_STATUS]:
                        hookObj.assessmentStatus,
                },
            });
        }

        return events;
    }

    async syncLandingPageHook({ hook, previousHook, source }) {
        const hookObj = toPlainObject(hook);
        const prevObj = toPlainObject(previousHook);
        const email =
            typeof hookObj?.email === "string"
                ? hookObj.email.trim().toLowerCase()
                : null;

        this.logger.info("Syncing a landing page hook to Klaviyo", {
            source,
            uuid: hookObj?.uuid,
            hasEmail: Boolean(email),
        });

        if (!email) {
            this.logger.warn("Landing page hook sync skipped, email missing", {
                source,
                uuid: hookObj?.uuid,
            });

            return { skipped: true, reason: KLAVIYO_MESSAGES.EMAIL_MISSING };
        }

        const properties = {
            [LP_KLAVIYO_PROPERTIES.PAYMENT_COMPLETED]:
                hookObj.paymentCompleted ?? undefined,
            [LP_KLAVIYO_PROPERTIES.PAYMENT_INITIATED]:
                hookObj.paymentInitiated ?? undefined,
            [LP_KLAVIYO_PROPERTIES.ASSESSMENT_STATUS]:
                hookObj.assessmentStatus ?? undefined,
            [LP_KLAVIYO_PROPERTIES.QUESTION_NUMBER]:
                hookObj.questionNumber ?? undefined,
            [LP_KLAVIYO_PROPERTIES.LANDING_PAGE_NAME]:
                hookObj.landingPageName ?? undefined,
            ...buildKlaviyoUtmProperties(hookObj),
            [LP_KLAVIYO_PROPERTIES.AGE]:
                hookObj.age != null
                    ? Number(hookObj.age) || hookObj.age
                    : undefined,
            [LP_KLAVIYO_PROPERTIES.COUNTRY]: hookObj.country ?? undefined,
            [LP_KLAVIYO_PROPERTIES.EMAIL]: email,
            [LP_KLAVIYO_PROPERTIES.NAME]: hookObj.name || undefined,
            [LP_KLAVIYO_PROPERTIES.ASSESSMENT_ID]: hookObj.assessmentId
                ? String(hookObj.assessmentId)
                : undefined,
            [LP_KLAVIYO_PROPERTIES.FUNNEL_STAGE]: funnelStage(hookObj),
            [LP_KLAVIYO_PROPERTIES.RESUME_URL]: buildResumeUrl(hookObj.uuid),
        };

        const mainCategory = await this.resolveMainCategory(
            hookObj.assessmentId,
        ).catch(() => undefined);

        if (mainCategory) {
            properties[LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY] = mainCategory;
        }

        const user = await User.findOne({ email }).select(
            LP_SELECT.KLAVIYO_USER,
        );

        if (user) await persistUtmDefaults(user);
        Object.assign(
            properties,
            buildKlaviyoUtmProperties(parseUtmParams(user || hookObj)),
        );
        if (user?.flowId) properties.flow_id = user.flowId;

        Object.assign(
            properties,
            await this.resolveLeaderboardRanks(user?._id),
        );

        const userUtms = buildKlaviyoUtmProperties(user);

        for (const [key, value] of Object.entries(userUtms)) {
            if (properties[key] === undefined) {
                properties[key] = value;
            }
        }

        const paymentJustCompleted =
            !prevObj?.paymentCompleted && Boolean(hookObj.paymentCompleted);

        if (paymentJustCompleted && user?._id) {
            const resetToken = crypto.randomBytes(32).toString("hex");

            await User.updateOne(
                { _id: user._id },
                { $set: { passwordResetToken: hashResetToken(resetToken) } },
            );

            properties[LP_KLAVIYO_PROPERTIES.RESET_PASSWORD] =
                buildPasswordResetUrl(resetToken);
        }

        await this.klaviyoService.upsertProfileByEmail({
            email,
            name: hookObj.name || user?.name,
            properties,
        });

        const updatedAtISO = toISOStringOrUndefined(
            hookObj.updatedAt || hookObj.createdAt || new Date(),
        );

        const events = this.buildEvents({
            hookObj,
            prevObj,
            email,
            mainCategory: properties[LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY],
        });

        for (const event of events) {
            await this.klaviyoService
                .createEvent({
                    email,
                    metricName: event.metricName,
                    properties: {
                        ...buildKlaviyoUtmProperties(hookObj),
                        ...event.properties,
                        ...buildKlaviyoUtmProperties(
                            parseUtmParams(user || hookObj),
                        ),
                    },
                    uniqueId: event.uniqueId,
                    timeISO: updatedAtISO,
                })
                .catch((err) =>
                    this.logger.error("Failed to create a Klaviyo event", {
                        metricName: event.metricName,
                        uuid: hookObj.uuid,
                        message: err.message,
                    }),
                );
        }

        this.logger.info("Synced a landing page hook to Klaviyo", {
            source,
            uuid: hookObj.uuid,
            events: events.map((event) => event.metricName),
        });

        return { ok: true };
    }

    async resolveStripePlanName(stripeSubscription) {
        const priceId = subscriptionPriceId(stripeSubscription);

        if (!this.stripe || !priceId) {
            return undefined;
        }

        try {
            const price = await this.stripe.prices.retrieve(priceId, {
                expand: LP_STRIPE_PRICE_EXPAND,
            });

            return price?.product?.name;
        } catch (err) {
            this.logger.warn("Reading the Stripe plan name failed", {
                priceId,
                message: err.message,
            });

            return undefined;
        }
    }

    async syncSubscription({
        userId,
        email,
        stripeSubscription,
        invoice,
        subscriptionRecord,
        previousSubscriptionStatus,
    }) {
        const safeEmail =
            typeof email === "string" ? email.trim().toLowerCase() : null;

        this.logger.info("Syncing a subscription to Klaviyo", {
            userId: userId ? String(userId) : undefined,
            hasEmail: Boolean(safeEmail),
            subscriptionId: stripeSubscription?.id,
        });

        if (!safeEmail) {
            this.logger.warn("Subscription sync skipped, email missing", {
                userId: userId ? String(userId) : undefined,
            });

            return { skipped: true, reason: KLAVIYO_MESSAGES.EMAIL_MISSING };
        }

        const subscription =
            stripeSubscription ||
            stripeSubscriptionFromRecord(subscriptionRecord);

        if (!subscription) {
            this.logger.warn(
                "Subscription sync skipped, subscription missing",
                {
                    userId: userId ? String(userId) : undefined,
                },
            );

            return {
                skipped: true,
                reason: LP_KLAVIYO_SYNC_REASONS.SUBSCRIPTION_MISSING,
            };
        }

        const statusLabel =
            LP_KLAVIYO_SUBSCRIPTION_STATUS_MAP[subscription.status] ||
            subscription.status ||
            undefined;
        const intervalLabel = subscriptionInterval(subscription);
        const planStartISO = fromStripeSecondsToISO(
            subscription.current_period_start,
        );
        const planEndISO = fromStripeSecondsToISO(
            subscription.current_period_end,
        );
        const trialStartISO = fromStripeSecondsToISO(subscription.trial_start);
        const trialEndISO = fromStripeSecondsToISO(subscription.trial_end);

        // A trial's $0 invoice has a zero-length line period (start === end),
        // so it can't be used as the plan end / next billing date — the real
        // one is trial_end.
        const isTrialing =
            subscription.status === STRIPE_SUBSCRIPTION_STATUSES.TRIALING;
        const invoiceLine = invoice?.lines?.data?.[0]?.period;
        const nextBillingDateISO =
            isTrialing && trialEndISO
                ? trialEndISO
                : invoiceLine?.end
                  ? fromStripeSecondsToISO(invoiceLine.end)
                  : (toISOStringOrUndefined(
                        subscriptionRecord?.nextBillingDate,
                    ) ?? planEndISO);
        const planEndFromInvoiceISO =
            isTrialing && trialEndISO
                ? trialEndISO
                : invoiceLine?.end
                  ? fromStripeSecondsToISO(invoiceLine.end)
                  : planEndISO;
        const planStartFromInvoiceISO = invoiceLine?.start
            ? fromStripeSecondsToISO(invoiceLine.start)
            : planStartISO;

        const planName = await this.resolveStripePlanName(subscription);

        const properties = {
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_NAME]:
                planName ?? undefined,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_DURATION]:
                intervalLabel ?? undefined,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_STATUS]:
                statusLabel ?? undefined,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_START_DATE]:
                planStartFromInvoiceISO ?? undefined,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_END_DATE]:
                planEndFromInvoiceISO ?? undefined,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.SUBSCRIPTION_ID]:
                subscription.id,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.TRIAL_START_DATE]:
                trialStartISO ?? undefined,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.TRIAL_END_DATE]:
                trialEndISO ?? undefined,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.CADENCE]:
                intervalLabel ?? undefined,
            [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.NEXT_BILLING_DATE]:
                nextBillingDateISO ?? undefined,
            ...cancellationSurveyProperties(subscriptionRecord),
        };

        Object.assign(properties, await this.resolveLeaderboardRanks(userId));

        const user = await User.findById(userId)
            .select(LP_SELECT.KLAVIYO_SUBSCRIPTION_USER)
            .lean();

        await this.klaviyoService.upsertProfileByEmail({
            email: safeEmail,
            name: user?.name,
            properties,
        });

        const activated =
            subscription.status === STRIPE_SUBSCRIPTION_STATUSES.ACTIVE &&
            previousSubscriptionStatus !== STRIPE_SUBSCRIPTION_STATUSES.ACTIVE;

        this.logger.info("Synced a subscription to Klaviyo", {
            userId: userId ? String(userId) : undefined,
            subscriptionId: subscription.id,
            status: statusLabel,
            activated,
        });

        if (!activated) {
            return { ok: true };
        }

        await this.klaviyoService
            .createEvent({
                email: safeEmail,
                metricName: KLAVIYO_EVENTS.SUBSCRIPTION_ACTIVATED,
                uniqueId: `${invoice?.id || subscription.id}:${LP_KLAVIYO_EVENT_IDS.SUBSCRIPTION_ACTIVATED}`,
                timeISO: invoice?.created
                    ? new Date(invoice.created * 1000).toISOString()
                    : toISOStringOrUndefined(new Date()),
                properties: {
                    [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_NAME]:
                        planName ?? undefined,
                    [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_DURATION]:
                        intervalLabel ?? undefined,
                    [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.SUBSCRIPTION_ID]:
                        subscription.id,
                    [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.NEXT_BILLING_DATE]:
                        nextBillingDateISO ?? undefined,
                },
            })
            .catch((err) =>
                this.logger.error("Failed to create a Klaviyo event", {
                    metricName: KLAVIYO_EVENTS.SUBSCRIPTION_ACTIVATED,
                    subscriptionId: subscription.id,
                    message: err.message,
                }),
            );

        const trialConverted =
            previousSubscriptionStatus ===
                STRIPE_SUBSCRIPTION_STATUSES.TRIALING &&
            subscription.status === STRIPE_SUBSCRIPTION_STATUSES.ACTIVE;

        if (trialConverted) {
            await this.klaviyoService
                .createEvent({
                    email: safeEmail,
                    metricName: KLAVIYO_EVENTS.STANDARD_PLAN_ACTIVATED,
                    uniqueId: `${invoice?.id || subscription.id}:${LP_KLAVIYO_EVENT_IDS.STANDARD_PLAN_ACTIVATED}`,
                    timeISO: invoice?.created
                        ? new Date(invoice.created * 1000).toISOString()
                        : toISOStringOrUndefined(new Date()),
                    properties: {
                        [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_NAME]:
                            planName ?? undefined,
                        [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.PLAN_DURATION]:
                            intervalLabel ?? undefined,
                        [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.SUBSCRIPTION_ID]:
                            subscription.id,
                        [LP_KLAVIYO_SUBSCRIPTION_PROPERTIES.NEXT_BILLING_DATE]:
                            nextBillingDateISO ?? undefined,
                    },
                })
                .catch((err) =>
                    this.logger.error("Failed to create a Klaviyo event", {
                        metricName: KLAVIYO_EVENTS.STANDARD_PLAN_ACTIVATED,
                        subscriptionId: subscription.id,
                        message: err.message,
                    }),
                );
        }

        return { ok: true };
    }

    async syncAssessmentPurchase({ order, purchasedAtISO }) {
        const orderObj = toPlainObject(order);
        const orderId = orderObj?._id ? String(orderObj._id) : undefined;

        this.logger.info("Syncing an assessment purchase to Klaviyo", {
            orderId,
        });

        if (!orderObj?.userId || !orderObj?.assessmentId) {
            this.logger.warn("Assessment purchase sync skipped, order fields", {
                orderId,
            });

            return {
                skipped: true,
                reason: LP_KLAVIYO_SYNC_REASONS.ORDER_FIELDS_MISSING,
            };
        }

        const user = await User.findById(orderObj.userId)
            .select(LP_SELECT.KLAVIYO_PURCHASE_USER)
            .lean();

        if (!user?.email) {
            this.logger.warn("Assessment purchase sync skipped, no email", {
                orderId,
            });

            return {
                skipped: true,
                reason: LP_KLAVIYO_SYNC_REASONS.USER_EMAIL_MISSING,
            };
        }

        const full = await this.assessmentService.findFullAssessmentById(
            orderObj.assessmentId,
            LP_SELECT.MAIN_CATEGORY_TITLE,
        );

        if (!full?.mainCategory) {
            this.logger.warn("Assessment purchase sync skipped, no category", {
                orderId,
            });

            return {
                skipped: true,
                reason: LP_KLAVIYO_SYNC_REASONS.MAIN_CATEGORY_MISSING,
            };
        }

        const mainCategory = full.mainCategory;
        const assessmentTitle = full.title || mainCategory;
        const categoryAssessments = await FullAssessment.find({ mainCategory })
            .select(LP_SELECT.ID)
            .lean();

        const purchasedCount = await Order.countDocuments({
            userId: orderObj.userId,
            status: ORDER_STATUSES.SUCCEEDED,
            assessmentId: {
                $in: categoryAssessments.map((doc) => doc._id),
            },
        });

        const properties = {
            [LP_KLAVIYO_PROPERTY_BUILDERS.totalPurchased(mainCategory)]:
                purchasedCount,
            [LP_KLAVIYO_PURCHASE_PROPERTIES.LAST_PURCHASED_NAME]:
                assessmentTitle,
            [LP_KLAVIYO_PURCHASE_PROPERTIES.LAST_PURCHASED_DATE]:
                purchasedAtISO,
            [LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY]: mainCategory,
        };

        Object.assign(properties, await this.resolveLeaderboardRanks(user._id));

        await this.klaviyoService.upsertProfileByEmail({
            email: user.email,
            name: user.name,
            properties,
        });

        await this.klaviyoService
            .createEvent({
                email: user.email,
                metricName: KLAVIYO_EVENTS.ASSESSMENT_PURCHASED,
                uniqueId: `${orderObj._id}:${LP_KLAVIYO_EVENT_IDS.ASSESSMENT_PURCHASED}`,
                timeISO: purchasedAtISO,
                properties: {
                    [LP_KLAVIYO_PROPERTIES.MAIN_CATEGORY]: mainCategory,
                    [LP_KLAVIYO_PURCHASE_PROPERTIES.LAST_PURCHASED_NAME]:
                        assessmentTitle,
                },
            })
            .catch((err) =>
                this.logger.error("Failed to create a Klaviyo event", {
                    metricName: KLAVIYO_EVENTS.ASSESSMENT_PURCHASED,
                    orderId,
                    message: err.message,
                }),
            );

        this.logger.info("Synced an assessment purchase to Klaviyo", {
            orderId,
            mainCategory,
            purchasedCount,
        });

        return { ok: true };
    }
}

module.exports = {
    KlaviyoSyncService,
    funnelStage,
    buildResumeUrl,
    buildPasswordResetUrl,
};
