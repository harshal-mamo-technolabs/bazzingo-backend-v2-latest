const HELPSCOUT_MESSAGES = {
    SIGNATURE_GENERATED: "Help Scout signature generated",
    INVALID_CREDENTIALS: "Invalid credentials",
    APP_SECRET_NOT_CONFIGURED:
        "Help Scout app secret is not configured (HELP_SCOUT_APP_SECRET or HELP_SCOUT_SECRET)",
    SECRET_NOT_CONFIGURED: "HELP_SCOUT_SECRET is not configured",
    USER_REQUIRED: "User is required to generate Help Scout signature",
    USER_EMAIL_REQUIRED: "Help Scout signatures require a user email",
    EMAIL_QUERY_REQUIRED: 'Query parameter "email" is required',
    INVALID_EMAIL: "Invalid email address",
    KLAVIYO_PROFILE_FAILED: "Could not load Klaviyo profile",
    KLAVIYO_NOT_CONFIGURED: "Klaviyo integration is not configured",
    KLAVIYO_PROFILE_FOUND: "Klaviyo profile found",
    KLAVIYO_PROFILE_ABSENT: "No Klaviyo profile for this email",
    MISCONFIGURED_PAGE:
        "<!DOCTYPE html><html><body><p>Server misconfiguration: set HELP_SCOUT_APP_SECRET or HELP_SCOUT_SECRET.</p></body></html>",
};

const HELPSCOUT_SKIP_REASONS = {
    MAILBOX_API_NOT_CONFIGURED: "mailbox_api_not_configured",
    MISSING_EMAIL: "missing_email",
    NO_PROPERTIES: "no_properties",
};

const HELPSCOUT_DEFAULTS = {
    FRAME_ANCESTORS: "https://secure.helpscout.net https://*.helpscout.net",
    UTM_SOURCE_SLUG: "utm_source",
    UTM_CAMPAIGN_SLUG: "utm_campaign",
    UTM_MEDIUM_SLUG: "utm_medium",
    UTM_VALUE: "default",
    FIRST_NAME: "User",
    SIGNATURE_EXPIRES_IN_SECONDS: 3600,
    TOKEN_EXPIRES_IN_SECONDS: 172800,
    TOKEN_REFRESH_MARGIN_MS: 60000,
};

const HELPSCOUT_API = {
    BASE_URL: "https://api.helpscout.net/v2",
    TOKEN_PATH: "/oauth2/token",
    CUSTOMERS_PATH: "/customers",
    BEARER_PREFIX: "Bearer ",
    EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};

module.exports = {
    HELPSCOUT_MESSAGES,
    HELPSCOUT_SKIP_REASONS,
    HELPSCOUT_DEFAULTS,
    HELPSCOUT_API,
};
