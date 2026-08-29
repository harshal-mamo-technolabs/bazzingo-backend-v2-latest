const path = require("path");
const dotenv = require("dotenv");

const NODE_ENV = process.env.NODE_ENV || "development";

dotenv.config({
    path: path.join(__dirname, `../../.env.${NODE_ENV}`),
});

const requireEnv = (key) => {
    const value = process.env[key];

    if (value === undefined || value === "") {
        throw new Error(`Missing required environment variable: ${key}`);
    }

    return value;
};

const optionalEnv = (key, fallback) => {
    const value = process.env[key];

    return value === undefined || value === "" ? fallback : value;
};

const config = {
    NODE_ENV,
    PORT: requireEnv("PORT"),
    MONGO_URI: requireEnv("MONGO_URI"),
    JWT_SECRET: requireEnv("JWT_SECRET"),
    ALLOWED_ORIGINS: optionalEnv("ALLOWED_ORIGINS", "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    LOG_LEVEL: optionalEnv("LOG_LEVEL", "info"),
    JOBS_ENABLED: optionalEnv("JOBS_ENABLED", "false") === "true",
    EMAIL_HOST: optionalEnv("EMAIL_HOST", ""),
    EMAIL_PORT: optionalEnv("EMAIL_PORT", ""),
    EMAIL_USER: optionalEnv("EMAIL_USER", ""),
    EMAIL_PASS: optionalEnv("EMAIL_PASS", ""),
    GOOGLE_CLIENT_ID: optionalEnv("GOOGLE_CLIENT_ID", ""),
    FRONTEND_URL: optionalEnv("FRONTEND_URL", ""),
    LANDING_PAGE_URL: optionalEnv("LANDING_PAGE_URL", ""),
    VAPID_PUBLIC_KEY: optionalEnv("VAPID_PUBLIC_KEY", ""),
    VAPID_PRIVATE_KEY: optionalEnv("VAPID_PRIVATE_KEY", ""),
    VAPID_CONTACT: optionalEnv("VAPID_CONTACT", ""),
    STRIPE_SECRET_KEY: optionalEnv("STRIPE_SECRET_KEY", ""),
    STRIPE_API_VERSION: optionalEnv("STRIPE_API_VERSION", ""),
    STRIPE_PUBLIC_KEY: optionalEnv("STRIPE_PUBLIC_KEY", ""),
    STRIPE_WEBHOOK_KEY: optionalEnv("STRIPE_WEBHOOK_KEY", ""),
    STRIPE_ELEMENTS_PRICE_ID: optionalEnv("STRIPE_ELEMENTS_PRICE_ID", ""),
    STRIPE_ELEMENTS_TRIAL_PRICE_ID: optionalEnv(
        "STRIPE_ELEMENTS_TRIAL_PRICE_ID",
        "",
    ),
    STRIPE_ELEMENTS_TRIAL_DAYS: optionalEnv("STRIPE_ELEMENTS_TRIAL_DAYS", ""),
    KLAVIYO_PRIVATE_API_KEY: optionalEnv("KLAVIYO_PRIVATE_API_KEY", ""),
    KLAVIYO_API_BASE_URL: optionalEnv("KLAVIYO_API_BASE_URL", ""),
    KLAVIYO_REVISION: optionalEnv("KLAVIYO_REVISION", "2024-02-15"),
    HELP_SCOUT_SECRET: optionalEnv("HELP_SCOUT_SECRET", ""),
    HELP_SCOUT_APP_SECRET: optionalEnv("HELP_SCOUT_APP_SECRET", ""),
    HELP_SCOUT_MAILBOX_APP_ID: optionalEnv("HELP_SCOUT_MAILBOX_APP_ID", ""),
    HELP_SCOUT_MAILBOX_APP_SECRET: optionalEnv(
        "HELP_SCOUT_MAILBOX_APP_SECRET",
        "",
    ),
    HELP_SCOUT_FRAME_ANCESTORS: optionalEnv(
        "HELP_SCOUT_FRAME_ANCESTORS",
        "https://secure.helpscout.net https://*.helpscout.net",
    ),
    HELP_SCOUT_UTM_SOURCE_SLUG: optionalEnv(
        "HELP_SCOUT_UTM_SOURCE_SLUG",
        "utm_source",
    ),
    HELP_SCOUT_UTM_CAMPAIGN_SLUG: optionalEnv(
        "HELP_SCOUT_UTM_CAMPAIGN_SLUG",
        "utm_campaign",
    ),
    HELP_SCOUT_UTM_MEDIUM_SLUG: optionalEnv(
        "HELP_SCOUT_UTM_MEDIUM_SLUG",
        "utm_medium",
    ),
    GOOGLE_TRANSLATE_KEY: optionalEnv("GOOGLE_TRANSLATE_KEY", ""),
    PLATFORM_NAME: optionalEnv("PLATFORM_NAME", ""),
    EMAIL_FROM_NAME: optionalEnv("EMAIL_FROM_NAME", "Bazzingo"),
    DEBUG_LB: optionalEnv("DEBUG_LB", "false") === "true",
};

module.exports = { config, requireEnv, optionalEnv };
