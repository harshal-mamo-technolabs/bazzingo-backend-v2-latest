const STRIPE_ELEMENTS_MESSAGES = {
    NOT_CONFIGURED: "Stripe is not configured",
    CONFIG_RETRIEVED: "Stripe configuration retrieved",
    DEFAULT_CONFIG_RETRIEVED: "Default configuration values retrieved",
    RECURRING_PRICE_ID_REQUIRED:
        "recurringPriceId is required. Provide it in request body or set STRIPE_ELEMENTS_PRICE_ID env variable.",
    TRIAL_PRICE_ID_REQUIRED:
        "trialPriceId is required when withTrial is true. Provide it in request body or set STRIPE_ELEMENTS_TRIAL_PRICE_ID env variable.",
    RECURRING_PRICE_INACTIVE: "The specified recurring price is not active",
    RECURRING_PRICE_TYPE: "The recurringPriceId must be a recurring price",
    TRIAL_PRICE_INACTIVE: "The specified trial price is not active",
    TRIAL_PRICE_TYPE: "The trialPriceId must be a one-time price",
    TRIAL_PRICE_PRODUCT:
        "The trialPriceId must belong to the same product as the recurring price",
    SETUP_INTENT_CREATED:
        "SetupIntent created. Collect card details and confirm, then call /activate-subscription.",
    SETUP_INTENT_FAILED: "Failed to create SetupIntent",
    SETUP_INTENT_NEXT_STEP:
        "After confirming SetupIntent, call POST /stripe-elements/activate-subscription with setupIntentId",
    SETUP_INTENT_ID_REQUIRED: "setupIntentId is required",
    SETUP_INTENT_NOT_OWNED: "This SetupIntent does not belong to your account",
    SETUP_INTENT_NO_PAYMENT_METHOD: "No payment method found on SetupIntent",
    SETUP_INTENT_NO_CUSTOMER: "No customer found on SetupIntent",
    RECURRING_PRICE_ID_MISSING: "recurringPriceId is required",
    SUBSCRIPTION_CREATED: "Subscription created successfully",
    SUBSCRIPTION_CONFIRM_PAYMENT:
        "Subscription created. Please confirm the payment.",
    ACTIVATION_FAILED: "Failed to activate subscription",
    SUBSCRIPTION_ID_REQUIRED: "subscriptionId is required",
    SUBSCRIPTION_ID_INVALID: "Invalid subscriptionId format",
    SUBSCRIPTION_NOT_OWNED: "This subscription does not belong to your account",
    SUBSCRIPTION_NOT_FOUND: "Subscription not found",
    SUBSCRIPTION_STATUS_RETRIEVED: "Subscription status retrieved",
    SUBSCRIPTION_STATUS_FAILED: "Failed to get subscription status",
    SUBSCRIPTION_ACTIVE: "Subscription is active",
    SUBSCRIPTION_TRIALING: "Subscription is in trial period",
    THREE_DS_STILL_REQUIRED: "3D Secure authentication still required",
    PAYMENT_METHOD_REQUIRED: "Payment method required or payment failed",
    PAYMENT_STILL_PROCESSING: "Payment is still processing",
    CONFIRMATION_FAILED: "Failed to confirm subscription",
    CANCELLED_IMMEDIATELY: "Subscription cancelled immediately",
    CANCELLED_AT_PERIOD_END:
        "Subscription will be cancelled at the end of the billing period",
    CANCELLATION_FAILED: "Failed to cancel subscription",
    SUBSCRIPTIONS_RETRIEVED: "User subscriptions retrieved",
    SUBSCRIPTIONS_FAILED: "Failed to get user subscriptions",
    CANCEL_REASON_STRING: "cancelReason must be a string",
    CANCEL_REASON_NON_EMPTY: "cancelReason must be a non-empty string",
    STAY_IF_OFFERED_ARRAY:
        "wouldHaveStayedIfOffered must be a non-empty array of strings",
    STAY_IF_OFFERED_STRINGS:
        "wouldHaveStayedIfOffered must contain only strings",
    STAY_IF_OFFERED_NON_EMPTY:
        "wouldHaveStayedIfOffered entries must not be empty",
    ASSESSMENT_ID_REQUIRED: "assessmentId is required",
    ASSESSMENT_NOT_FOUND: "Assessment not found",
    ASSESSMENT_WITHOUT_PRODUCT: "Assessment has no Stripe product ID",
    PRICE_NOT_FOUND: "Price not found or not active",
    ADHD_PRICE_MISMATCH: "priceCatalogId does not match this ADHD assessment",
    ADHD_PRODUCT_UNRESOLVED:
        "Could not resolve Stripe product for ADHD assessment. Set priceCatalogId on the assessment or pass a valid priceCatalogId.",
    EI_PRICE_MISMATCH:
        "priceCatalogId does not match this emotional intelligence assessment",
    EI_PRODUCT_UNRESOLVED:
        "Could not resolve Stripe product for emotional intelligence assessment. Set priceCatalogId on the assessment or pass a valid priceCatalogId.",
    NO_ACTIVE_PRICE: "No active price found for this assessment",
    PAYMENT_INTENT_CREATED:
        "Payment intent created. Use clientSecret with Stripe Elements to collect payment.",
    PAYMENT_INTENT_NEXT_STEP:
        "Use clientSecret with Stripe Elements, then call stripe.confirmPayment()",
    PAYMENT_CREATION_FAILED: "Failed to create payment",
    ORDER_ID_REQUIRED: "orderId is required",
    ORDER_NOT_FOUND: "Order not found",
    ORDER_NOT_OWNED: "This order does not belong to your account",
    PAYMENT_STATUS_RETRIEVED: "Payment status retrieved",
    PAYMENT_STATUS_FAILED: "Failed to get payment status",
    ORDER_WITHOUT_PAYMENT_INTENT: "No payment intent found for this order",
    PAYMENT_SUCCESSFUL_BANG: "Payment successful!",
    THREE_DS_REQUIRED: "3D Secure authentication required",
    PAYMENT_METHOD_FAILED:
        "Payment failed. Please try a different payment method.",
    PAYMENT_CONFIRMATION_FAILED: "Failed to confirm payment",
    ORDERS_RETRIEVED: "Orders retrieved",
    ORDERS_FAILED: "Failed to get orders",
    NO_PAYMENT_METHOD: "No payment method available. Please add a card first.",
    NO_STRIPE_CUSTOMER:
        "No Stripe customer found. Please complete a payment first.",
    ADDITIONAL_AUTH_REQUIRED: "Additional authentication required",
    CARD_DECLINED: "Card was declined",
    PAYMENT_FAILED: "Payment failed",
    PRICE_CATALOG_NOT_FOUND: "priceCatalogId not found or not active",
    BELOW_STRIPE_MINIMUM:
        "Resolved price is below the Stripe minimum (50 cents)",
    PRICE_CATALOG_ID_REQUIRED:
        "Provide an assessmentId or a one-time priceCatalogId",
    PAYMENT_SUCCESSFUL: "Payment successful",
    COLLECT_PAYMENT_METHOD:
        "Enter card details to complete payment. Your card will be saved for one-click next time.",
    PAYMENT_METHODS_RETRIEVED: "Payment methods retrieved",
    PAYMENT_METHODS_FAILED: "Failed to get payment methods",
    CARD_SETUP_INTENT_CREATED:
        "SetupIntent created. Collect card details and confirm, then call /payment-methods/confirm.",
    CARD_SAVED: "Card saved",
    CARD_SAVE_FAILED: "Failed to save card",
    PAYMENT_METHOD_NOT_OWNED:
        "This payment method does not belong to your account",
    PAYMENT_METHOD_REMOVED: "Card removed",
    PAYMENT_METHOD_REMOVE_FAILED: "Failed to remove card",
    DEFAULT_PAYMENT_METHOD_SET: "Default card updated",
    DEFAULT_PAYMENT_METHOD_FAILED: "Failed to update default card",
};

const STRIPE_ELEMENTS_DYNAMIC_MESSAGES = {
    setupIntentWithTrialCreated: (trialDays) =>
        `SetupIntent created. Trial fee will be charged immediately, then subscription starts after ${trialDays} days.`,
    setupIntentNotConfirmed: (status) =>
        `SetupIntent is not confirmed. Status: ${status}`,
    trialStarted: (trialEndDate) =>
        `Trial started! Subscription will begin on ${trialEndDate}`,
    confirmTrialPayment: (trialDays) =>
        `Please confirm trial payment. Subscription will start after ${trialDays}-day trial.`,
    subscriptionStatus: (status) => `Subscription status: ${status}`,
    paymentStatus: (status) => `Payment status: ${status}`,
    paymentOutcome: (status) => `Payment ${status}`,
    stripeResourceNotFound: (message) =>
        `Stripe resource not found: ${message}`,
    cancelReasonTooLong: (max) =>
        `cancelReason must be at most ${max} characters`,
    stayIfOfferedTooLong: (max) =>
        `wouldHaveStayedIfOffered is too large when stored (max ${max} characters serialized)`,
    assessmentDescription: (name) => `Assessment: ${name}`,
};

const STRIPE_ELEMENTS_DEFAULTS = {
    TRIAL_DAYS: 3,
    CURRENCY: "eur",
    PRODUCT_NAME: "Payment",
    FULL_ASSESSMENT_NAME: "Full Assessment",
    ADHD_ASSESSMENT_NAME: "ADHD Assessment",
    EI_ASSESSMENT_NAME: "Emotional Intelligence Assessment",
    UTM_VALUE: "organic",
    MINIMUM_AMOUNT: 50,
    METADATA_VALUE_MAX: 500,
    SUBSCRIPTION_ID_PREFIX: "sub_",
    STRIPE_SUBSCRIPTION_LIMIT: 100,
    PAYMENT_INTENT_LIST_LIMIT: 5,
};

const STRIPE_ELEMENTS_PRICE_TYPES = {
    RECURRING: "recurring",
    ONE_TIME: "one_time",
};

const STRIPE_ELEMENTS_ITEM_TYPES = {
    ASSESSMENT: "assessment",
};

const STRIPE_ELEMENTS_RESPONSE_STATUS = {
    REQUIRES_ACTION: "requires_action",
    PENDING: "pending",
    PROCESSING: "processing",
};

const STRIPE_ELEMENTS_FLOWS = {
    ELEMENTS: "stripe_elements",
    ELEMENTS_TRIAL: "stripe_elements_trial",
    CUSTOMER_SOURCE: "stripe_elements_flow",
    PAYMENT_CUSTOMER_SOURCE: "stripe_elements_payment",
    PAYMENT: "stripe_elements_payment",
    QUICK_PAY: "stripe_elements_quick_pay",
    GENERIC_ONE_CLICK: "stripe_elements_generic_one_click",
    GENERIC_COLLECT: "stripe_elements_generic_collect",
    TRIAL_FEE: "trial_fee",
    CARD_MANAGEMENT: "stripe_elements_card_management",
};

const STRIPE_ELEMENTS_ASSESSMENT_KINDS = {
    FULL: "full",
    ADHD: "adhd",
    EMOTIONAL_INTELLIGENCE: "emotional_intelligence",
};

const STRIPE_ELEMENTS_PAY_OUTCOMES = {
    PAID: "paid",
    REQUIRES_ACTION: "requires_action",
    PROCESSING: "processing",
    COLLECT_PAYMENT_METHOD: "collect_payment_method",
};

const STRIPE_ELEMENTS_CANCELLATION_METADATA_KEYS = {
    CANCEL_REASON: "bazingo_cancel_reason",
    STAY_IF_OFFERED: "bazingo_stay_if_offered",
};

const STRIPE_ELEMENTS_ERROR_TYPES = {
    INVALID_REQUEST: "StripeInvalidRequestError",
    CARD: "StripeCardError",
};

const STRIPE_ELEMENTS_ERROR_CODES = {
    RESOURCE_MISSING: "resource_missing",
    AUTHENTICATION_REQUIRED: "authentication_required",
};

const STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES = {
    ACTIVE: "active",
    TRIALING: "trialing",
    INCOMPLETE: "incomplete",
};

const STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES = {
    SUCCEEDED: "succeeded",
    PROCESSING: "processing",
    REQUIRES_ACTION: "requires_action",
    REQUIRES_CONFIRMATION: "requires_confirmation",
    REQUIRES_PAYMENT_METHOD: "requires_payment_method",
    CANCELED: "canceled",
};

const STRIPE_ELEMENTS_ORDER_STATUS_BY_PAYMENT_INTENT = {
    succeeded: "succeeded",
    processing: "processing",
    requires_action: "requires_action",
    requires_payment_method: "requires_payment_method",
    canceled: "canceled",
};

const STRIPE_ELEMENTS_GENERIC_ORDER_STATUS_BY_PAYMENT_INTENT = {
    ...STRIPE_ELEMENTS_ORDER_STATUS_BY_PAYMENT_INTENT,
    requires_confirmation: "requires_action",
};

module.exports = {
    STRIPE_ELEMENTS_MESSAGES,
    STRIPE_ELEMENTS_DYNAMIC_MESSAGES,
    STRIPE_ELEMENTS_DEFAULTS,
    STRIPE_ELEMENTS_PRICE_TYPES,
    STRIPE_ELEMENTS_ITEM_TYPES,
    STRIPE_ELEMENTS_RESPONSE_STATUS,
    STRIPE_ELEMENTS_FLOWS,
    STRIPE_ELEMENTS_ASSESSMENT_KINDS,
    STRIPE_ELEMENTS_PAY_OUTCOMES,
    STRIPE_ELEMENTS_CANCELLATION_METADATA_KEYS,
    STRIPE_ELEMENTS_ERROR_TYPES,
    STRIPE_ELEMENTS_ERROR_CODES,
    STRIPE_ELEMENTS_SUBSCRIPTION_STATUSES,
    STRIPE_ELEMENTS_PAYMENT_INTENT_STATUSES,
    STRIPE_ELEMENTS_ORDER_STATUS_BY_PAYMENT_INTENT,
    STRIPE_ELEMENTS_GENERIC_ORDER_STATUS_BY_PAYMENT_INTENT,
};
