const FULL_ASSESSMENT_MESSAGES = {
    LISTED: "Full assessments (one per category with priority logic)",
    CREATED: "Full assessment created",
    QUESTIONS_ADDED: "Questions added",
    QUICK_MINIS_GENERATED: "Quick mini assessments generated",
    FETCHED: "Full assessment",
    QUICK_FETCHED: "Quick mini assessment",
    TODAYS_QUICK: "Today's quick assessment",
    NO_QUICK_TODAY: "No quick assessment assigned today",
    QUICK_SUBMITTED_ASSIGNED:
        "Quick assessment score submitted (today's assignment)",
    QUICK_SUBMITTED_UNASSIGNED:
        "Quick assessment score submitted (not today's assignment)",
    FULL_SUBMITTED: "Full assessment score submitted",
    LATEST_SCORES: "Latest assessment scores retrieved",
    PRICE_ATTACHED: "Price attached to assessment successfully",
    PROGRAM_SCORES: "User program scores retrieved successfully",
    SCORE_FETCHED: "Assessment score",
    SUBSCRIPTION_AND_ASSESSMENTS: "User subscription and assessments",
    STATISTICS: "Assessment statistics retrieved successfully",
    DAILY_RECOMMENDED: "Daily recommended assessment retrieved successfully",
    CURRENT_MINI_PURCHASE_STATUS:
        "Current mini assessment with purchase status retrieved successfully",
    SUBMITTED_FULL: "User submitted full assessments retrieved successfully",
    NO_SUBMITTED_FULL: "No submitted full assessments found",
    FULL_SCORES: "Full assessment scores retrieved successfully",
    NO_FULL_SCORES: "No full assessment scores found",
    CREATE_REQUIRED: "mainCategory, questions and subcategories are required",
    STRIPE_PRODUCT_REQUIRED: "stripeProductId is required",
    NOT_FOUND: "Full assessment not found",
    QUESTIONS_NOT_FOUND: "Full assessment questions not found",
    QUICK_NOT_FOUND: "Quick mini assessment not found",
    ASSIGNED_QUICK_NOT_FOUND: "Assigned quick assessment not found",
    SCORE_NOT_FOUND: "Score not found",
    INVALID_TYPE: "Invalid type",
    SUBMIT_REQUIRED: "assessmentId and answers[] are required",
    ATTACH_REQUIRED: "assessmentId and priceCatalogId are required",
    ASSESSMENT_NOT_FOUND: "Assessment not found",
    PRICE_NOT_FOUND: "PriceCatalog entry not found",
    PRICE_NOT_ASSESSMENT: "Provided price is not an assessment price",
    PRICE_WRONG_ASSESSMENT: "Price does not belong to the specified assessment",
    PRICE_NOT_ONE_TIME:
        "Only one-time (assessment) prices can be attached to assessments",
    NO_ASSESSMENTS_AVAILABLE: "No assessments available",
    USER_NOT_FOUND: "User not found",
    NO_SUBCATEGORIES: "No subcategories defined",
    NO_QUESTIONS: "No questions found",
};

const ASSESSMENT_AGE_GROUPS = [
    { min: 1, max: 12, label: "1-12" },
    { min: 13, max: 17, label: "13-17" },
    { min: 18, max: 25, label: "18-25" },
    { min: 26, max: 34, label: "26-34" },
    { min: 35, max: 44, label: "35-44" },
    { min: 45, max: 64, label: "45-64" },
    { min: 55, max: Infinity, label: "55+" },
];

const UNKNOWN_AGE_GROUP = "unknown";

const IQ_CALIBRATION = {
    SAMPLE_THRESHOLD: 100,
    BASE_OFFSET: 70,
    BASE_DIVISOR: 150,
    BASE_RANGE: 60,
    MEAN: 100,
    STANDARD_DEVIATION: 15,
    MIN: 0,
    MAX: 200,
};

const ASSESSMENT_DEFAULTS = {
    POINTS: 5,
    FIXED_POINT: 5,
    QUICK_MINIS: 4,
    MINI_SIZE: 10,
    LATEST_SCORES_LIMIT: 5,
    CURRENCY: "EUR",
    MAIN_CATEGORY: "assessment",
    UNKNOWN_ASSESSMENT: "Unknown Assessment",
    UNKNOWN_USER: "Unknown User",
    QUICK_ASSESSMENT_NAME: "Quick Assessment",
};

const LEGACY_SCORE_CATEGORIES = {
    IQ_TEST: "iq-test",
    DRIVING_LICENCE: "driving-licence",
};

const SUBSCRIPTION_ACTIVE_STATUSES = ["active", "trialing"];

const PLAN_DURATIONS = { monthly: "Monthly", yearly: "Yearly" };

const ASSESSMENT_STAT_PERIODS = [
    { name: "today", days: 0 },
    { name: "last7Days", days: 7 },
    { name: "last1Month", days: 30 },
    { name: "last3Months", days: 90 },
    { name: "last6Months", days: 180 },
    { name: "last1Year", days: 365 },
];

module.exports = {
    FULL_ASSESSMENT_MESSAGES,
    ASSESSMENT_AGE_GROUPS,
    UNKNOWN_AGE_GROUP,
    IQ_CALIBRATION,
    ASSESSMENT_DEFAULTS,
    LEGACY_SCORE_CATEGORIES,
    SUBSCRIPTION_ACTIVE_STATUSES,
    PLAN_DURATIONS,
    ASSESSMENT_STAT_PERIODS,
};
