const PLAN_MESSAGES = {
    CREATED: "Plan created successfully",
    LISTED: "Plans retrieved successfully",
    PRICES_UPDATED: "Plan prices updated successfully",
    DIRECT_CREATED: "Plan created",
    PRICE_ATTACHED: "Price attached to plan successfully",
    NAME_REQUIRED: "name is required",
    STRIPE_PRODUCT_ID_REQUIRED: "stripeProductId is required",
    PLAN_ID_REQUIRED: "planId is required",
    PRICE_TYPE_REQUIRED: "priceType is required",
    PRICE_ID_REQUIRED: "priceId is required",
    INVALID_PRICE_TYPE: "priceType must be one of: monthly, yearly, trial",
    INVALID_INTERVAL_COUNT: "intervalCount must be a positive integer",
    NOT_FOUND: "Plan not found",
    PRICE_NOT_FOUND: "Price not found in catalog",
    STRIPE_NOT_CONFIGURED: "Stripe is not configured",
    CREATE_FAILED: "Failed to create plan",
};

const PLAN_PRICE_TYPES = {
    MONTHLY: "monthly",
    YEARLY: "yearly",
    TRIAL: "trial",
};

const PLAN_PRICE_SELECT_FIELDS =
    "currency unitAmount stripePriceId active default productDuration";

const PLAN_STRIPE_PRODUCT_TYPE = "subscription_plan";

const PLAN_UNIT_AMOUNT_DIVISOR = 100;

const PLAN_DEFAULT_INTERVAL_COUNT = 1;

module.exports = {
    PLAN_MESSAGES,
    PLAN_PRICE_TYPES,
    PLAN_PRICE_SELECT_FIELDS,
    PLAN_STRIPE_PRODUCT_TYPE,
    PLAN_UNIT_AMOUNT_DIVISOR,
    PLAN_DEFAULT_INTERVAL_COUNT,
};
