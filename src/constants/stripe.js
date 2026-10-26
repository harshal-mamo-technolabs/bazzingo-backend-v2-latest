const STRIPE_RESPONSE_STATUSES = {
    REQUIRES_ACTION: "requires_action",
};

const STRIPE_UTM_DEFAULT = "organic";

const STRIPE_UTM_METADATA_KEYS = {
    SOURCE: "utm_source",
    CAMPAIGN: "utm_campaign",
    MEDIUM: "utm_medium",
    EMAIL: "utm_email",
};

const STRIPE_PRICE_TYPES = {
    ONE_TIME: "one_time",
    RECURRING: "recurring",
};

const STRIPE_PRODUCT_DURATIONS = {
    DAILY: "daily",
    WEEKLY: "weekly",
    MONTHLY: "monthly",
    YEARLY: "yearly",
    ONETIME: "onetime",
};

const STRIPE_PLAN_PRODUCT_DURATIONS = ["daily", "weekly", "monthly", "yearly"];

const STRIPE_DURATION_INTERVALS = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
};

const STRIPE_SUBSCRIPTION_TYPES = {
    TRIAL: "trial",
    MONTHLY: "monthly",
    YEARLY: "yearly",
};

const STRIPE_SUBSCRIPTION_TYPE_VALUES = ["trial", "monthly", "yearly"];

const STRIPE_CADENCES = {
    MONTHLY: "monthly",
    YEARLY: "yearly",
};

const STRIPE_SUBSCRIPTION_STATUSES = {
    INCOMPLETE: "incomplete",
    TRIALING: "trialing",
    ACTIVE: "active",
    PAST_DUE: "past_due",
    CANCELED: "canceled",
    UNPAID: "unpaid",
};

const STRIPE_ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"];

const STRIPE_TRIAL_TRANSITION_STATUSES = ["trialing", "past_due"];

const STRIPE_PAYMENT_INTENT_STATUSES = {
    SUCCEEDED: "succeeded",
    PROCESSING: "processing",
    REQUIRES_ACTION: "requires_action",
    FAILED: "failed",
};

const STRIPE_DEFAULT_CURRENCY = "EUR";

const STRIPE_FREE_TRIAL_DAYS = 3;

const STRIPE_DEFAULT_INTERVAL_COUNT = 1;

const STRIPE_PRICE_ID_PREFIX = "price_";

const STRIPE_PRICE_ID_PATTERN = /price_[^\s']+/;

const STRIPE_PRICE_ID_CANDIDATE_FIELDS = [
    "stripePriceId",
    "stripe_id",
    "stripeId",
    "priceId",
    "id",
];

const STRIPE_ERROR_TYPES = {
    INVALID_REQUEST: "StripeInvalidRequestError",
};

const STRIPE_ERROR_CODES = {
    RESOURCE_MISSING: "resource_missing",
    AUTHENTICATION_REQUIRED: "authentication_required",
};

const STRIPE_FLOWS = {
    CHECKOUT_CUSTOMER: "checkout_flow",
    ONE_CLICK: "one_click",
    CHECKOUT: "checkout",
    SUBSCRIPTION_CUSTOMER: "subscription_checkout_flow",
    SUBSCRIPTION_CHECKOUT: "subscription_checkout",
    PAID_TRIAL_CHECKOUT: "paid_trial_checkout",
    ONE_CLICK_SUBSCRIPTION_MANUAL_PI: "one_click_subscription_manual_pi",
    ONE_CLICK_SUBSCRIPTION_AFTER_PI: "one_click_subscription_after_pi",
    CONFIRMED_AFTER_3DS: "confirmed_after_3ds",
};

const STRIPE_WEBHOOK_ELEMENTS_FLOWS = [
    "stripe_elements",
    "stripe_elements_trial",
    "stripe_elements_regular_subscription",
    "stripe_elements_paid_trial_subscription",
];

const STRIPE_ORDER_SELECT_FIELDS = {
    ID: "_id",
    ASSESSMENT_ID: "assessmentId",
};

const STRIPE_USER_SELECT_FIELDS = "email name";

const STRIPE_USER_SUBSCRIPTION_SELECT_FIELDS =
    "planId status planDuration priceCatalogId cancelAtPeriodEnd cancelAt";

const STRIPE_BILLING_REASONS = {
    SUBSCRIPTION_CYCLE: "subscription_cycle",
    REFUND: "refund",
};

const STRIPE_METADATA_VALUE_MAX = 500;

const STRIPE_CANCELLATION_METADATA_KEYS = {
    CANCEL_REASON: "bazingo_cancel_reason",
    STAY_IF_OFFERED: "bazingo_stay_if_offered",
};

const STRIPE_WEBHOOK_EVENTS = {
    CHECKOUT_SESSION_COMPLETED: "checkout.session.completed",
    CHECKOUT_SESSION_ASYNC_PAYMENT_SUCCEEDED:
        "checkout.session.async_payment_succeeded",
    CHECKOUT_SESSION_ASYNC_PAYMENT_FAILED:
        "checkout.session.async_payment_failed",
    CHECKOUT_SESSION_EXPIRED: "checkout.session.expired",
    PAYMENT_INTENT_SUCCEEDED: "payment_intent.succeeded",
    PAYMENT_INTENT_PAYMENT_FAILED: "payment_intent.payment_failed",
    CUSTOMER_SUBSCRIPTION_CREATED: "customer.subscription.created",
    CUSTOMER_SUBSCRIPTION_UPDATED: "customer.subscription.updated",
    CUSTOMER_SUBSCRIPTION_DELETED: "customer.subscription.deleted",
    CUSTOMER_SUBSCRIPTION_TRIAL_WILL_END:
        "customer.subscription.trial_will_end",
    INVOICE_PAYMENT_SUCCEEDED: "invoice.payment_succeeded",
    INVOICE_PAYMENT_FAILED: "invoice.payment_failed",
    INVOICE_PAID: "invoice.paid",
    PAYMENT_METHOD_ATTACHED: "payment_method.attached",
    CHARGE_REFUNDED: "charge.refunded",
    CUSTOMER_DELETED: "customer.deleted",
};

const STRIPE_WEBHOOK_LIMITS = {
    CHECKOUT_SESSIONS: 10,
    INVOICES: 10,
    SUBSCRIPTIONS: 10,
    SUBSCRIPTION_INVOICES: 5,
    LATEST_INVOICE: 1,
};

const STRIPE_WEBHOOK_SESSION_MATCH_WINDOW_SECONDS = 300;

const STRIPE_DUPLICATE_INVOICE_WINDOW_MS = 300000;

const STRIPE_SAME_PERIOD_TOLERANCE_MS = 1000;

const STRIPE_AMOUNT_DIVISOR = 100;

const STRIPE_TRIAL_DEBUG_PLACEHOLDERS = {
    NONE: "none",
    UNKNOWN: "unknown",
};

const STRIPE_TRIAL_RESPONSE_ACTIONS = {
    REQUIRES_3DS: "requires_3ds_authentication",
    TRIAL_ENDED: "trial_ended_successfully",
    SUBSCRIPTION_ACTIVATED: "subscription_activated",
    PAYMENT_METHOD_REQUIRED: "payment_method_required",
    PAYMENT_FAILED: "payment_failed",
    UNEXPECTED_PAYMENT_STATUS: "unexpected_payment_status",
    UNEXPECTED_STATUS: "unexpected_status",
    UNKNOWN: "unknown",
};

const STRIPE_TRIAL_STEPS = {
    FIND_SUBSCRIPTION: "find_subscription",
    VALIDATE_STATUS: "validate_status",
};

const STRIPE_TRIAL_REASONS = {
    NO_PAYMENT_METHOD: "no_payment_method",
    PAYMENT_FAILED: "payment_failed",
};

const STRIPE_TRIAL_NEXT_STEPS = {
    COMPLETE_3DS_AND_RETRY:
        "Complete 3DS authentication, then call this API again",
    COMPLETE_3DS_TO_ACTIVATE:
        "Complete 3DS authentication to activate subscription",
    SUBSCRIPTION_ACTIVE: "Subscription is now active",
    ADD_PAYMENT_METHOD: "Add or update payment method and retry payment",
    UPDATE_PAYMENT_METHOD: "Update payment method and retry payment",
    CONTACT_SUPPORT_INVESTIGATION:
        "Contact support with this requestId for investigation",
    CONTACT_SUPPORT: "Contact support with this requestId",
};

const STRIPE_TRIAL_ERRORS = {
    NO_TRIAL_STATUS: "No subscription with status trialing or past_due",
    INVALID_TRIAL_STATUS: "Invalid status for trial ending",
    INTERNAL: "Internal server error",
    NO_PAYMENT_INTENT:
        "Could not create payment intent for monthly invoice. Payment method may be missing or invalid.",
};

const STRIPE_SET_PASSWORD_EMAIL = {
    TOKEN_EXPIRY: "24h",
    subject: (platformName = "TestBrain") =>
        `Create your ${platformName} password`,
    MESSAGE_PREFIX:
        "Please create your password by clicking the following link: ",
};

const STRIPE_MESSAGES = {
    PROVIDE_ASSESSMENT_OR_PLAN:
        "Provide either assessmentId or planId (exclusively)",
    UNIT_AMOUNT_INVALID:
        "unitAmount must be a non-negative number (in smallest currency unit)",
    ASSESSMENT_NOT_FOUND: "Assessment not found",
    ASSESSMENT_WITHOUT_PRODUCT: "Assessment has no Stripe product ID",
    PLAN_NOT_FOUND: "Plan not found",
    PLAN_WITHOUT_PRODUCT: "Plan has no Stripe product ID",
    PRODUCT_DURATION_INVALID:
        "productDuration must be one of 'daily' | 'weekly' | 'monthly' | 'yearly' for plan prices",
    STRIPE_NOT_CONFIGURED: "Stripe is not configured",
    PRICE_CREATED: "Price created successfully",
    PRICE_CREATE_FAILED: "Failed to create price",
    ASSESSMENT_ID_REQUIRED: "assessmentId is required",
    URLS_REQUIRED: "successUrl and cancelUrl are required",
    NO_ONE_TIME_PRICE: "No active one-time price found for this assessment",
    PAYMENT_INITIATED_WITH_SAVED_CARD: "Payment initiated with saved card",
    THREE_D_SECURE_REQUIRED: "3D Secure authentication required",
    CHECKOUT_SESSION_CREATED: "Checkout session created",
    CHECKOUT_SESSION_FAILED: "Failed to create checkout session",
    PLAN_ID_REQUIRED: "planId is required",
    TYPE_REQUIRED: "type is required",
    TYPE_INVALID: "type must be one of: trial, monthly, yearly",
    USER_NOT_FOUND: "User not found",
    PLAN_WITHOUT_RECURRING_PRICE:
        "Plan must have either monthly or yearly price to create a subscription",
    RECURRING_PRICE_INACTIVE: "Recurring price is inactive",
    TRIAL_PRICE_INACTIVE: "Trial price is inactive",
    RECURRING_PRICE_NOT_RECURRING: "Recurring price must be a recurring price",
    TRIAL_PRICE_NOT_ONE_TIME: "Trial price must be a one-time price",
    CURRENCY_MISMATCH: "Currency mismatch between recurring and trial prices",
    SUBSCRIPTION_THREE_D_SECURE_REQUIRED:
        "3D Secure authentication required for subscription",
    PAID_TRIAL_SUBSCRIPTION_WITH_SAVED_CARD:
        "Paid + 3-day free trial subscription created with saved card",
    TRIAL_FALLBACK_SUBSCRIPTION_WITH_SAVED_CARD:
        "Trial requested but plan has no trial price — created regular subscription with saved card",
    SUBSCRIPTION_WITH_SAVED_CARD: "Subscription created with saved card",
    PAID_TRIAL_CHECKOUT_SESSION_CREATED:
        "Paid + 3-day free trial Checkout session created",
    TRIAL_FALLBACK_CHECKOUT_SESSION_CREATED:
        "Trial requested but plan has no trial price — created regular subscription Checkout session",
    SUBSCRIPTION_CHECKOUT_SESSION_CREATED:
        "Subscription Checkout session created",
    NO_SUBSCRIPTION_FOUND: "No subscription found",
    SUBSCRIPTION_FOUND: "Subscription found",
    SESSION_ID_REQUIRED: "stripeSessionId is required",
    PRESENCE_CHECK_COMPLETED: "Presence check completed",
    PRESENCE_CHECK_FAILED: "Failed to check session presence",
    SESSION_OR_ORDER_REQUIRED: "Either sessionId or orderId is required",
    SESSION_AND_ORDER_EXCLUSIVE:
        "Please provide only one of sessionId or orderId, not both",
    ORDER_NOT_FOUND: "Order not found or assessment not linked to this order",
    ASSESSMENT_ID_RETRIEVED: "Assessment ID retrieved successfully",
    ASSESSMENT_ID_FAILED: "Failed to retrieve assessment ID",
    HAS_ACTIVE_SUBSCRIPTION: "User has active subscription",
    HAS_NO_ACTIVE_SUBSCRIPTION: "User has no active subscription",
    USER_SUBSCRIPTION_STATUS_FAILED: "Failed to get user subscription status",
    PAYMENT_INTENT_ID_REQUIRED: "paymentIntentId is required",
    PAYMENT_INTENT_REQUIRES_ACTION: "PaymentIntent still requires action",
    PAYMENT_INTENT_NOT_SUCCEEDED:
        "PaymentIntent must be succeeded to create subscription",
    SUBSCRIPTION_WITH_TRIAL_AFTER_3DS:
        "Subscription created with trial after 3D Secure authentication",
    SUBSCRIPTION_AFTER_3DS:
        "Subscription created after 3D Secure authentication",
    CONFIRM_SUBSCRIPTION_FAILED:
        "Failed to create subscription after authentication",
    NO_ACTIVE_SUBSCRIPTION_FOUND: "No active subscription found",
    SUBSCRIPTION_ALREADY_CANCELED: "Subscription is already canceled",
    SUBSCRIPTION_CANCEL_AT_PERIOD_END:
        "Subscription will be canceled at the end of the current period",
    SUBSCRIPTION_CANCELED_IMMEDIATELY:
        "Subscription has been canceled immediately",
    SUBSCRIPTION_CANCEL_FAILED: "Failed to cancel subscription",
    CANCEL_REASON_NOT_STRING: "cancelReason must be a string",
    CANCEL_REASON_EMPTY: "cancelReason must be a non-empty string",
    STAY_IF_OFFERED_NOT_ARRAY:
        "wouldHaveStayedIfOffered must be a non-empty array of strings",
    STAY_IF_OFFERED_NOT_STRINGS:
        "wouldHaveStayedIfOffered must contain only strings",
    STAY_IF_OFFERED_ENTRY_EMPTY:
        "wouldHaveStayedIfOffered entries must not be empty",
    NO_TRIAL_SUBSCRIPTION_FOUND: "No active trial subscription found",
    RETRIEVE_SUBSCRIPTION_FAILED: "Failed to retrieve subscription from Stripe",
    THREE_D_SECURE_BEFORE_TRIAL_END:
        "3D Secure authentication required before ending trial",
    TRIAL_ENDED_SUBSCRIPTION_ACTIVE:
        "Trial ended successfully. Subscription is now active.",
    TRIAL_ENDED_AND_ACTIVATED:
        "Trial ended and subscription activated successfully!",
    TRIAL_ENDED_NEEDS_THREE_D_SECURE:
        "Trial ended, but 3D Secure authentication required to activate subscription",
    TRIAL_ENDED_WITHOUT_PAYMENT_METHOD:
        "Trial ended, but no valid payment method found. Please add a payment method.",
    TRIAL_ENDED_PAYMENT_FAILED:
        "Trial ended, but payment failed. Please update your payment method.",
    PAYMENT_FAILED_UPDATE_METHOD:
        "Payment failed. Please update your payment method.",
    UNKNOWN_TRIAL_STATE: "Unknown state detected. Please contact support.",
    TRIAL_TRANSITION_FAILED:
        "Internal server error occurred while processing trial end",
    WEBHOOK_SECRET_NOT_CONFIGURED: "Webhook secret not configured",
    WEBHOOK_STRIPE_NOT_CONFIGURED: "Stripe not configured",
    WEBHOOK_NO_PAYLOAD: "No webhook payload was provided",
    WEBHOOK_HANDLER_FAILED: "Webhook handler failed",
    INVOICES_FETCHED: "Invoices fetched successfully",
    INVOICES_FETCH_FAILED: "Failed to fetch invoices",
};

const STRIPE_MESSAGE_BUILDERS = {
    cancelReasonTooLong: (max) =>
        `cancelReason must be at most ${max} characters`,
    stayIfOfferedTooLarge: (max) =>
        `wouldHaveStayedIfOffered is too large when stored (max ${max} characters serialized)`,
    planPriceNotConfigured: (type) =>
        `Plan does not have a ${type} price configured`,
    priceCatalogNotFound: (ref) => `PriceCatalog not found for ref: ${ref}`,
    priceCatalogWithoutStripeId: (id) =>
        `PriceCatalog ${id} is missing a valid Stripe price id (expected 'price_...')`,
    priceCatalogWithoutStripeIdShort: (id) =>
        `PriceCatalog ${id} is missing a valid Stripe price id`,
    checkoutPriceMissing: (id) =>
        `Stripe price not found: ${id}. The price may have been deleted in Stripe or does not exist. Please update the PriceCatalog entry or create a new price.`,
    subscriptionPricesMissing: (ids) =>
        `Stripe price not found: ${ids}. The price(s) may have been deleted in Stripe or do not exist. Please verify the prices exist in your Stripe account.`,
    subscriptionPriceMissing: (id) =>
        `Stripe price not found: ${id}. The price may have been deleted in Stripe. Please verify the price exists in your Stripe account.`,
    unexpectedPaymentIntentStatus: (status) =>
        `Unexpected PaymentIntent status: ${status}`,
    cannotEndTrial: (status) =>
        `Cannot end trial. Subscription status is ${status}`,
    unexpectedPaymentStatus: (status) =>
        `Unexpected payment status: ${status}. Please contact support.`,
    trialProcessingCompleted: (status) =>
        `Trial processing completed with status: ${status}`,
    unexpectedStatusAfterTrialEnd: (status) =>
        `Unexpected status after trial end: ${status}`,
    assessmentPurchaseDescription: (mainCategory) =>
        `Assessment ${mainCategory} purchase`,
    subscriptionDescription: (planName, cadence) =>
        `${planName} subscription (${cadence})`,
    webhookError: (reason) => `Webhook Error: ${reason}`,
    setPasswordEmailHtml: (resetUrl, platformName = "TestBrain") => `
        <div style="background-color:#F7F5F1;padding:40px 16px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <div style="max-width:480px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E8E3DB;border-radius:8px;overflow:hidden;">
            <div style="padding:32px 32px 0 32px;text-align:center;">
              <span style="display:inline-block;font-size:22px;font-weight:700;color:#163C3A;letter-spacing:-0.02em;">${platformName}</span>
            </div>
            <div style="padding:24px 32px 32px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:#111827;text-align:center;">Welcome to ${platformName}!</h1>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#64748B;text-align:center;">
                Your trial has started, thanks for joining. Please create a new password to seamlessly access the portal in any other system.
              </p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="${resetUrl}" style="display:inline-block;background-color:#163C3A;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">
                  Create Your Password
                </a>
              </div>
              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#64748B;text-align:center;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;text-align:center;word-break:break-all;">
                <a href="${resetUrl}" style="color:#163C3A;">${resetUrl}</a>
              </p>
              <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">This link will expire in 24 hours.</p>
            </div>
            <div style="background-color:#F7F5F1;padding:16px 32px;text-align:center;border-top:1px solid #E8E3DB;">
              <p style="margin:0;font-size:12px;color:#64748B;">&copy; ${new Date().getFullYear()} ${platformName}. All rights reserved.</p>
            </div>
          </div>
        </div>
        `,
};

module.exports = {
    STRIPE_RESPONSE_STATUSES,
    STRIPE_UTM_DEFAULT,
    STRIPE_UTM_METADATA_KEYS,
    STRIPE_PRICE_TYPES,
    STRIPE_PRODUCT_DURATIONS,
    STRIPE_PLAN_PRODUCT_DURATIONS,
    STRIPE_DURATION_INTERVALS,
    STRIPE_SUBSCRIPTION_TYPES,
    STRIPE_SUBSCRIPTION_TYPE_VALUES,
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
    STRIPE_WEBHOOK_EVENTS,
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
};
