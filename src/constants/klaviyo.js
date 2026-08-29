const KLAVIYO_MESSAGES = {
    API_KEY_REQUIRED: "klaviyo-api-key query parameter is required",
    PROFILES_FETCH_FAILED: "Failed to fetch Klaviyo profiles",
    EVENTS_FETCH_FAILED: "Failed to fetch Klaviyo events",
    METRICS_FETCH_FAILED: "Failed to fetch Klaviyo metrics",
    RATE_LIMIT_EXCEEDED:
        "[KlaviyoProxy] Klaviyo rate limit exceeded after maximum retries",
    UNKNOWN_ERROR: "Unknown Klaviyo error",
    ENV_MISSING: "Klaviyo env vars missing",
    EMAIL_MISSING: "email missing",
    METRIC_NAME_MISSING: "metricName missing",
};

const KLAVIYO_RESOURCES = {
    PROFILES: {
        path: "profiles",
        label: "profile",
        defaultPageSize: 100,
        maxPageSize: 19,
        pageSizeParam: true,
    },
    EVENTS: {
        path: "events",
        label: "event",
        defaultPageSize: 200,
        maxPageSize: 200,
        pageSizeParam: true,
    },
    METRICS: {
        path: "metrics",
        label: "metric",
        defaultPageSize: null,
        maxPageSize: null,
        pageSizeParam: false,
    },
};

const KLAVIYO_PROXY = {
    DEFAULT_API_BASE_URL: "https://a.klaviyo.com/api",
    DEFAULT_REVISION: "2026-04-15",
    MAX_PAGES: 100000,
    REQUEST_TIMEOUT_MS: 30000,
    MAX_RETRIES_PER_PAGE: 5,
    RATE_LIMITED_STATUS: 429,
    UPSTREAM_ERROR_STATUS: 502,
    ERROR_PREFIX: "[KlaviyoProxy]",
};

const KLAVIYO_API = {
    REVISION: "2024-02-15",
    POST_TIMEOUT_MS: 8000,
    GET_TIMEOUT_MS: 10000,
    ERROR_PREFIX: "[Klaviyo]",
    PROFILE_TYPE: "profile",
    EVENT_TYPE: "event",
    METRIC_TYPE: "metric",
    BAZZINGO_PROPERTY: "bazzingo",
    PROFILES_PATH: "/profiles/",
    PROFILE_IMPORT_PATH: "/profile-import",
    EVENTS_PATH: "/events",
};

module.exports = {
    KLAVIYO_MESSAGES,
    KLAVIYO_RESOURCES,
    KLAVIYO_PROXY,
    KLAVIYO_API,
};
