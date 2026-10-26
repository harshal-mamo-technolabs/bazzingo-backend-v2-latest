const stripeConstants = require("./stripe");
const stripeElementsConstants = require("./stripeElements");
const dashboardConstants = require("./dashboard");
const authConstants = require("./auth");
const lpConstants = require("./lp");
const jobsConstants = require("./jobs");
const translateConstants = require("./translate");
const klaviyoConstants = require("./klaviyo");
const helpscoutConstants = require("./helpscout");
const certificateConstants = require("./certificate");
const planConstants = require("./plan");
const priceCatalogConstants = require("./priceCatalog");
const assessmentConstants = require("./assessment");

const DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:8080",
    "https://testbrain.net",
    "https://bazinggo.com",
    "https://bazingoo.com",
    "https://bazzingo.net",
    "https://bazingo.testbrain.net",
    "https://portal.bazinggo.com",
    "https://portal.lumria.net",
    "https://lumria.com",
    "https://mozgovka.com",
    "https://brainy-spark-craft.lovable.app",
    "https://id-preview--db7cedbb-c50e-4093-88c2-36c36016b11c.lovable.app",
    "https://db7cedbb-c50e-4093-88c2-36c36016b11c.lovableproject.com",
    "https://portal.testbrain.net",
    "https://merkgo.com"
];

const CORS_OPTIONS = {
    METHODS: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    EXPOSED_HEADERS: ["X-Total-Count", "X-Page-Count"],
    OPTIONS_SUCCESS_STATUS: 200,
};

const RESPONSE_STATUS = {
    SUCCESS: "success",
    ERROR: "error",
    FAIL: "fail",
};

const ACCOUNT_DELETED_REASON = "account_deleted";

const AUTH_MESSAGES = {
    AUTHENTICATION_REQUIRED: "Authentication required",
    INVALID_TOKEN: "Invalid token",
    ACCOUNT_DELETED:
        "This account has been deleted. Please contact support if you want it restored.",
};

const USER_MESSAGES = {
    PROFILE_FETCHED: "User profile",
    PROFILE_UPDATED: "User updated",
    PREFERENCES_UPDATED: "Notification preferences updated",
    NOT_FOUND: "User not found",
    NO_VALID_FIELDS: "No valid fields to update",
    NO_VALID_PREFERENCE_FIELDS: "No valid preference fields to update",
    INVALID_AGE: "Age should be a whole number between 1 and 120",
};

const ACCOUNT_DELETION = {
    DELETED: "Your account has been deleted",
    ALREADY_DELETED: "This account is already deleted.",
    ALREADY_DELETED_REASON: "already_deleted",
    ACTIVE_SUBSCRIPTION:
        "Please cancel your active subscription before deleting your account.",
    ACTIVE_SUBSCRIPTION_REASON: "active_subscription",
    BLOCKING_STATUSES: ["active", "trialing", "past_due"],
    SOURCE: "web",
    NOT_PROVIDED: "Not provided",
    NO_SUBSCRIPTION: "none",
};

const DATA_EXPORT = {
    VERSION: "1.0",
    READY: "Your personal data export is ready",
};

const USER_UPDATABLE_FIELDS = ["name", "avatar", "age", "country"];

const USER_TEXT_FIELDS = ["name", "avatar", "country"];

const USER_LEADERBOARD_SYNCED_FIELDS = ["name", "avatar", "age", "country"];

const NOTIFICATION_PREFERENCE_FIELDS = {
    email: [
        "gameReminders",
        "newAssessmentsAvailable",
        "achievementAndBadgeAlerts",
        "weeklyPerformanceSummary",
    ],
    push: ["enablePushNotifications"],
    newsletter: ["subscribeToTipsAndNews"],
};

const USER_AGE_RANGE = { MIN: 1, MAX: 120 };

const BCRYPT_SALT_ROUNDS = 10;

const ADMIN_TOKEN_EXPIRY = "365d";

const ADMIN_ROLES = {
    SUPERADMIN: "superadmin",
    MANAGER: "manager",
    MODERATOR: "moderator",
};

const ADMIN_MESSAGES = {
    REGISTERED: "Admin registered successfully",
    LOGIN_SUCCESS: "Login successful",
    ALREADY_EXISTS: "Admin already exists with this email",
    INVALID_CREDENTIALS: "Incorrect email or password",
    LOGIN_REQUIRED: "Email and password are required",
    SIGNUP_REQUIRED: "Name, email and password are required",
    AUTH_REQUIRED: "Admin authentication required",
    INVALID_ADMIN: "Invalid or inactive admin",
    FORBIDDEN: "Forbidden: Insufficient privileges",
};

const LEADERBOARD_SCOPES = {
    GLOBAL: "global",
    COUNTRY: "country",
    AGE: "age",
};

const LEADERBOARD_RANK_FIELDS = {
    GAME_GLOBAL: "gameGlobalRank",
    ASSESSMENT_GLOBAL: "assessmentGlobalRank",
    GAME_COUNTRY: "gameCountryRank",
    ASSESSMENT_COUNTRY: "assessmentCountryRank",
    GAME_AGE_GROUP: "gameAgeGroupRank",
    ASSESSMENT_AGE_GROUP: "assessmentAgeGroupRank",
};

const LEADERBOARD_PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MIN_LIMIT: 1,
    MAX_LIMIT: 100,
};

const LEADERBOARD_MESSAGES = {
    FETCHED: "Leaderboard",
    COUNTRY_REQUIRED: "country is required for scope=country",
    AGE_GROUP_REQUIRED: "ageGroup is required for scope=age",
};

const LEADERBOARD_BUCKETS = {
    GAME: "game",
    ASSESSMENT: "assessment",
};

const WEEK_DAYS = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
];

const MONDAY_FIRST_WEEK_DAYS = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
];

const DUPLICATE_KEY_ERROR_CODE = 11000;

const GAME_MESSAGES = {
    CREATED: "Game created",
    LISTED: "Games",
    STATS: "Games stats",
    PLAY_TRACKED: "Play tracked",
    RECENTLY_PLAYED: "Recently played",
    UNIQUE_GAMES_COUNT: "Unique games count",
    DAILY_SUGGESTIONS: "Daily suggestions",
    NO_DAILY_SUGGESTIONS: "No daily suggestions found",
    SCORE_RECORDED: "Score recorded",
    ZERO_SCORE: "Score 0 cannot be recorded",
    WEEKLY_SCORES: "Current week daily scores",
    STATISTICS: "Game statistics retrieved successfully",
    CREATE_REQUIRED: "name, category and url are required",
    GAME_ID_REQUIRED: "gameId is required",
    SCORE_REQUIRED: "gameId and numeric score are required",
    NOT_FOUND: "Game not found",
    NOT_SUGGESTED: "Game not suggested today",
    ALREADY_RECORDED: "Score for this game was already recorded today",
};

const STREAK_MESSAGES = {
    SAVED: "Daily activity saved",
    STREAK_DATA: "Streak data",
    FLAG_REQUIRED:
        "Provide at least one of isGamePlayed or isAssessmentCompleted",
    RANGE_INCOMPLETE:
        "Both startDate and endDate are required when filtering by date range.",
    RANGE_INVALID:
        "Invalid startDate or endDate. Use an ISO date string (e.g., 2025-08-24).",
};

const PUSH_MESSAGES = {
    SUBSCRIBED: "Subscribed to push notifications successfully",
    UNSUBSCRIBED: "Unsubscribed",
    SUBSCRIPTION_FOUND: "Push subscription found",
    NO_SUBSCRIPTION: "No active push subscription found",
    INVALID_PAYLOAD: "Invalid subscription payload",
    ENDPOINT_REQUIRED: "endpoint is required",
};

const NOTIFICATION_TARGET_TYPES = {
    ALL: "ALL",
    USER: "USER",
    CRITERIA: "CRITERIA",
};

const NOTIFICATION_UPDATABLE_FIELDS = [
    "title",
    "body",
    "imageUrl",
    "websiteUrl",
    "target",
    "isActive",
];

const NOTIFICATION_PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MIN_LIMIT: 1,
    ADMIN_MAX_LIMIT: 100,
    USER_MAX_LIMIT: 20,
};

const NOTIFICATION_MESSAGES = {
    CREATED: "Notification created",
    LISTED: "Notifications",
    FETCHED: "Notification",
    UPDATED: "Notification updated",
    DELETED: "Notification deleted",
    MARKED_READ: "Notification marked as read",
    NOT_FOUND: "Notification not found",
    CREATE_REQUIRED: "title, body and target.type are required",
    TEST_OK: "Test notification endpoint working",
    MINIMAL_OK: "Minimal test working",
    DEBUG_OK: "Admin middleware debug completed",
    DEBUG_NO_TOKEN: "No Bearer token found",
    DEBUG_FAILED: "Admin middleware debug failed",
};

const EXPIRED_PUSH_STATUS_CODES = [404, 410];

const BADGE_NAMES = {
    LOGIC_MASTER: "logic-master",
    MEMORY_MACHINE: "memory-machine",
    REFLEX_NINJA: "reflex-ninja",
    STREAK_STARTER: "streak-starter",
    GAME_EXPLORER: "game-explorer",
    SMART_START: "smart-start",
    BRAIN_BOOSTER: "brain-booster",
    GENIUS_CERTIFIED: "genius-certified",
    CONSISTENT_THINKER: "consistent-thinker",
    FIRST_MILESTONE: "first-milestone",
    IMPROVER: "improver",
    LEADERBOARD_ROOKIE: "leaderboard-rookie",
    TOP_10_CHAMPION: "top-10-champion",
    BAZINGO_BELIEVER: "bazingo-believer",
    EARLY_ADOPTER: "early-adopter",
};

const BADGE_THRESHOLDS = {
    LOGIC_MASTER_SCORE: 180,
    LOGIC_MASTER_COUNT: 3,
    MEMORY_MACHINE_SCORE: 160,
    MEMORY_MACHINE_COUNT: 5,
    REFLEX_NINJA_PERCENTILE: 10,
    STREAK_STARTER_DAYS: 3,
    GAME_EXPLORER_COUNT: 10,
    SMART_START_IQ: 100,
    BRAIN_BOOSTER_IQ: 120,
    GENIUS_CERTIFIED_IQ: 140,
    CONSISTENT_THINKER_DAYS: 4,
    IMPROVER_GAIN: 10,
    TOP_10_CHAMPION_RANK: 10,
    BAZINGO_BELIEVER_DAYS: 30,
    EARLY_ADOPTER_USERS: 1000,
};

const BADGE_CONTEXT_TYPES = {
    GAME: "game",
    ASSESSMENT: "assessment",
};

const BADGE_MESSAGES = {
    LISTED: "All badges retrieved successfully",
    BULK_INSERTED: "Badges bulk inserted successfully",
    RANKS_AND_BADGES: "User ranks and badges retrieved successfully",
};

const GAME_CATEGORIES = {
    LOGIC: "Logic",
    MEMORY: "Memory",
    GAMEACY: "Gameacy",
};

const ASSESSMENT_CATEGORIES = {
    IQ_TEST: "iq-test",
};

const ASSESSMENT_TYPES = {
    FULL: "full",
    QUICK: "quick",
};

const QUESTION_TYPES = ["text", "image"];

const ORDER_STATUSES = {
    REQUIRES_PAYMENT_METHOD: "requires_payment_method",
    REQUIRES_ACTION: "requires_action",
    PROCESSING: "processing",
    SUCCEEDED: "succeeded",
    CANCELED: "canceled",
    FAILED: "failed",
    UNPAID: "unpaid",
    PARTIALLY_REFUNDED: "partially_refunded",
    REFUNDED: "refunded",
};

const ADHD_REPORT_CATEGORY_KEYS = [
    "inattention",
    "executive_dysfunction",
    "hyperactivity",
    "impulsivity",
    "emotional_regulation",
    "memory",
    "functional_impact",
];

const EI_REPORT_CATEGORY_KEYS = [
    "self_awareness",
    "self_regulation",
    "empathy",
    "social_skills",
    "stress_management",
    "motivation",
];

const ASSESSMENT_MESSAGES = {
    INVALID_ASSESSMENT_ID: "Invalid assessment id",
    QUESTIONS_REQUIRED: "questions array is required",
    QUESTIONS_MIN: "questions must be a number >= 1",
    PRICE_CATALOG_INVALID: "priceCatalogId must be a valid ObjectId",
    QUICK_IDS_NOT_ARRAY: "quickAssessmentIds must be an array",
    QUICK_IDS_INVALID: "Each quickAssessmentIds entry must be a valid ObjectId",
    OPTION_SCORES_EMPTY: "optionScores must be a non-empty number array",
    INVALID_TYPE: 'type must be "full" or "quick"',
    ASSESSMENT_ID_REQUIRED: "Valid assessmentId is required",
    ANSWERS_REQUIRED: "answers must be a non-empty array",
    NO_SCORE: "No score found for this assessment",
};

const EI_MESSAGES = {
    CREATED: "Emotional intelligence assessment created",
    QUESTIONS_ADDED: "Emotional intelligence questions added",
    FETCHED: "Emotional intelligence assessment",
    REPORT_SUMMARY: "Emotional intelligence assessment report summary",
    REPORTS_LIST: "Emotional intelligence full assessment reports",
    SCORE_SUBMITTED: "Emotional intelligence assessment score submitted",
    NOT_FOUND: "Emotional intelligence assessment not found",
    CREATE_REQUIRED: "questions and subCategories are required",
};

const ADHD_MESSAGES = {
    CREATED: "ADHD assessment created",
    QUESTIONS_ADDED: "ADHD questions added",
    FETCHED: "ADHD assessment",
    REPORT_SUMMARY: "ADHD assessment report summary",
    REPORTS_LIST: "ADHD full assessment reports",
    SCORE_SUBMITTED: "ADHD assessment score submitted",
    NOT_FOUND: "ADHD assessment not found",
    CREATE_REQUIRED: "questions and subCategories are required",
};

const KLAVIYO_EVENTS = {
    ACCOUNT_DELETED: "BAZZINGO:ACCOUNT_DELETED",
    ASSESSMENT_PURCHASED: "BAZZINGO:ASSESSMENT_PURCHASED",
    SUBSCRIPTION_ACTIVATED: "BAZZINGO:SUBSCRIPTION_ACTIVATED",
    LANDING_PAGE_EMAIL_CAPTURED: "BAZZINGO:LANDING_PAGE_EMAIL_CAPTURED",
    LANDING_PAGE_ASSESSMENT_COMPLETED: "BAZZINGO:LANDING_PAGE_ASSESSMENT_COMPLETED",
    LANDING_PAGE_PAYMENT_INITIATED: "BAZZINGO:LANDING_PAGE_PAYMENT_INITIATED",
    LANDING_PAGE_PAYMENT_COMPLETED: "BAZZINGO:LANDING_PAGE_PAYMENT_COMPLETED",
    LANDING_PAGE_RESUMED_FROM_EMAIL: "BAZZINGO:LANDING_PAGE_RESUMED_FROM_EMAIL",
    LANDING_PAGE_EMAIL_FLOW_PAYMENT_INITIATED: "BAZZINGO:LANDING_PAGE_EMAIL_FLOW_PAYMENT_INITIATED",
    LANDING_PAGE_EMAIL_FLOW_PAYMENT_COMPLETED: "BAZZINGO:LANDING_PAGE_EMAIL_FLOW_PAYMENT_COMPLETED",
    STANDARD_PLAN_ACTIVATED: "BAZZINGO:STANDARD_PLAN_ACTIVATED"
};

const KLAVIYO_PROFILE_PROPERTIES = {
    ACCOUNT_DELETED: "bazingo-account deleted",
    ACCOUNT_DELETION_REASON: "bazingo-account deletion reason",
    WOULD_HAVE_STAYED_IF_OFFERED: "bazingo-would have stayed if offered",
    ACCOUNT_DELETED_AT: "bazingo-account deleted at",
};

module.exports = {
    DEFAULT_ALLOWED_ORIGINS,
    CORS_OPTIONS,
    ...stripeConstants,
    ...stripeElementsConstants,
    ...dashboardConstants,
    ...authConstants,
    ...lpConstants,
    ...jobsConstants,
    ...translateConstants,
    ...klaviyoConstants,
    ...helpscoutConstants,
    ...certificateConstants,
    ...planConstants,
    ...priceCatalogConstants,
    ...assessmentConstants,
    RESPONSE_STATUS,
    ACCOUNT_DELETED_REASON,
    AUTH_MESSAGES,
    USER_MESSAGES,
    USER_UPDATABLE_FIELDS,
    ACCOUNT_DELETION,
    DATA_EXPORT,
    USER_TEXT_FIELDS,
    USER_LEADERBOARD_SYNCED_FIELDS,
    NOTIFICATION_PREFERENCE_FIELDS,
    USER_AGE_RANGE,
    BCRYPT_SALT_ROUNDS,
    ADMIN_TOKEN_EXPIRY,
    ADMIN_MESSAGES,
    ADMIN_ROLES,
    LEADERBOARD_SCOPES,
    LEADERBOARD_RANK_FIELDS,
    LEADERBOARD_PAGINATION,
    LEADERBOARD_MESSAGES,
    LEADERBOARD_BUCKETS,
    WEEK_DAYS,
    MONDAY_FIRST_WEEK_DAYS,
    DUPLICATE_KEY_ERROR_CODE,
    GAME_MESSAGES,
    STREAK_MESSAGES,
    PUSH_MESSAGES,
    NOTIFICATION_TARGET_TYPES,
    NOTIFICATION_UPDATABLE_FIELDS,
    NOTIFICATION_PAGINATION,
    NOTIFICATION_MESSAGES,
    EXPIRED_PUSH_STATUS_CODES,
    BADGE_NAMES,
    BADGE_THRESHOLDS,
    BADGE_CONTEXT_TYPES,
    BADGE_MESSAGES,
    GAME_CATEGORIES,
    ASSESSMENT_CATEGORIES,
    ASSESSMENT_TYPES,
    QUESTION_TYPES,
    ORDER_STATUSES,
    ADHD_REPORT_CATEGORY_KEYS,
    EI_REPORT_CATEGORY_KEYS,
    ASSESSMENT_MESSAGES,
    ADHD_MESSAGES,
    EI_MESSAGES,
    KLAVIYO_EVENTS,
    KLAVIYO_PROFILE_PROPERTIES,
};

const exported = module.exports;
const seen = new Map();

for (const [name, group] of Object.entries({
    translate: translateConstants,
    klaviyo: klaviyoConstants,
    helpscout: helpscoutConstants,
    certificate: certificateConstants,
    plan: planConstants,
    priceCatalog: priceCatalogConstants,
    assessment: assessmentConstants,
    stripe: stripeConstants,
    stripeElements: stripeElementsConstants,
    dashboard: dashboardConstants,
    auth: authConstants,
    lp: lpConstants,
    jobs: jobsConstants,
})) {
    for (const key of Object.keys(group)) {
        if (seen.has(key)) {
            throw new Error(
                `Duplicate constant key "${key}" exported by both ${seen.get(key)} and ${name}`,
            );
        }

        seen.set(key, name);
    }
}

void exported;
