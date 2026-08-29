const TRANSLATE_API_URL =
    "https://translation.googleapis.com/language/translate/v2";

const TRANSLATE_LIMITS = {
    MAX_BATCH_SIZE: 50,
    CACHE_TTL_MS: 24 * 60 * 60 * 1000,
    MAX_CACHE_ENTRIES: 5000,
    MIN_INTERVAL_MS: 1100,
    MAX_RETRIES: 3,
};

const TRANSLATE_LANGUAGE_ALIASES = {
    solvik: "sk",
};

const TRANSLATE_LANGUAGE_LABELS = {
    SOURCE: "Source",
    TARGET: "Target",
};

const TRANSLATE_LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}([_-][a-z0-9]{2,8})?$/i;

const TRANSLATE_MESSAGES = {
    TRANSLATED: "Texts translated",
    Q_REQUIRED: "Texts to translate (q) is required",
    Q_NOT_ARRAY: "Texts to translate (q) must be a non-empty array",
    SOURCE_REQUIRED: "Source language code (source) is required",
    TARGET_REQUIRED: "Target language code (target) is required",
    API_KEY_MISSING: "GOOGLE_TRANSLATE_KEY is not configured",
    TEXTS_NOT_ARRAY: "Texts to translate must be a non-empty array",
    NO_TRANSLATION: "No translation returned from API",
    RATE_LIMIT_EXCEEDED: `Translation rate limit exceeded after ${TRANSLATE_LIMITS.MAX_RETRIES} retries. Please try again later.`,
    TEXT_NOT_STRING: (index) => `Text at index ${index} must be a string`,
    LANGUAGE_REQUIRED: (label) => `${label} language code is required`,
    LANGUAGE_EMPTY: (label) => `${label} language code cannot be empty`,
    LANGUAGE_INVALID: (label, languageCode) =>
        `Invalid ${label.toLowerCase()} language code: ${languageCode}`,
    REQUEST_FAILED: (status, statusText) =>
        `Translation failed: ${status} ${statusText}`,
    INVALID_REQUEST: (message) => `Invalid translation request: ${message}`,
};

module.exports = {
    TRANSLATE_API_URL,
    TRANSLATE_LIMITS,
    TRANSLATE_LANGUAGE_ALIASES,
    TRANSLATE_LANGUAGE_LABELS,
    TRANSLATE_LANGUAGE_CODE_PATTERN,
    TRANSLATE_MESSAGES,
};
