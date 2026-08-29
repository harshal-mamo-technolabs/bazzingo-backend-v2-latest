const PRICE_CATALOG_MESSAGES = {
    CREATED: "PriceCatalog entry created",
    STRIPE_PRICE_ID_REQUIRED: "stripePriceId is required",
    STRIPE_PRODUCT_ID_REQUIRED: "stripeProductId is required",
    TYPE_REQUIRED: "type is required (recurring | one_time)",
    UNIT_AMOUNT_REQUIRED: "unitAmount is required and must be a number",
};

const PRICE_CATALOG_DEFAULTS = {
    CURRENCY: "EUR",
    PRODUCT_DURATION: "monthly",
};

module.exports = {
    PRICE_CATALOG_MESSAGES,
    PRICE_CATALOG_DEFAULTS,
};
