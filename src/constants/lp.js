const LP_MESSAGES = {
    UUID_REQUIRED: "UUID is required",
    HOOK_CREATED: "Hook created",
    HOOK_UPDATED: "Hook updated",
    HOOK_RESUMED: "Hook resumed",
    HOOK_NOT_FOUND: "Hook not found",
    QUICK_ASSESSMENT_ID_REQUIRED: "Quick assessment ID is required",
    QUICK_ASSESSMENT_NOT_FOUND: "Quick assessment not found",
    QUICK_ASSESSMENT_NOT_ACTIVE: "Quick assessment is not active",
    QUICK_MINI_NOT_FOUND: "Quick mini assessment not found",
    FULL_ASSESSMENT_NOT_FOUND: "Full assessment not found",
    FULL_ASSESSMENT_NOT_ACTIVE: "Full assessment is not active",
    QUICK_ASSESSMENT_FETCHED: "Quick assessment retrieved successfully",
    TOKEN_REQUIRED: "Token is required",
    SUBMIT_REQUIRED: "assessmentId and answers array are required",
    INVALID_TOKEN: "Invalid or expired token",
    USER_NOT_FOUND: "User not found",
    QUESTIONS_NOT_FOUND: "Questions not found for this assessment",
    SCORE_SUBMITTED: "Quick assessment score submitted successfully",
};

const LP_HOOK_UPDATABLE_FIELDS = [
    "email",
    "name",
    "age",
    "country",
    "paymentCompleted",
    "paymentInitiated",
    "assessmentStatus",
    "questionNumber",
    "assessmentId",
    "landingPageName",
    "answers",
    "utmEmail",
];

const LP_HOOK_SNAPSHOT_FIELDS = [
    "email",
    "name",
    "age",
    "country",
    "paymentCompleted",
    "paymentInitiated",
    "assessmentStatus",
    "questionNumber",
    "assessmentId",
    "landingPageName",
    "utmSource",
    "utmCampaign",
    "utmMedium",
    "uuid",
];

const LP_LEADERBOARD_RANK_FIELDS = [
    "gameGlobalRank",
    "assessmentGlobalRank",
    "gameCountryRank",
    "assessmentCountryRank",
    "gameAgeGroupRank",
    "assessmentAgeGroupRank",
];

const LP_FUNNEL_STAGES = {
    LANDING: "landing",
    COMPLETED: "completed",
    QUIZ: "quiz",
    DETAILS: "details",
    CHECKOUT: "checkout",
};

const LP_ASSESSMENT_STATUS = {
    PENDING: "pending",
    COMPLETED: "completed",
};

const LP_SYNC_SOURCES = {
    HOOK_CREATE: "hook.create",
    HOOK_UPDATE: "hook.update",
    HOOK_RESUME: "hook.resume",
};

const LP_SELECT = {
    QUICK_MINI: "_id fullAssessment questions size order isActive createdAt",
    FULL_ASSESSMENT: "_id title description mainCategory active",
    QUESTION_DETAIL:
        "_id subcategory questionType imageQuestionDescription question optionsType options answerIndex points",
    QUESTION_SCORING: "_id subcategory answerIndex points",
    MAIN_CATEGORY: "mainCategory",
    MAIN_CATEGORY_TITLE: "mainCategory title",
    FULL_ASSESSMENT_REF: "fullAssessment",
    AGE: "age",
    KLAVIYO_USER: "_id name age country utmSource utmCampaign utmMedium flowId",
    KLAVIYO_SUBSCRIPTION_USER: "name",
    KLAVIYO_PURCHASE_USER: "_id email name",
    ID: "_id",
};

const LP_PROGRAM_SCORE = {
    SAMPLE_THRESHOLD: 100,
    BASE_OFFSET: 70,
    BASE_DIVISOR: 50,
    BASE_RANGE: 60,
    MEAN: 100,
    STANDARD_DEVIATION: 15,
    MIN: 0,
    MAX: 200,
};

const LP_RESUME_TOKEN_EXPIRY = "30m";

const LP_RESUME_URL = {
    PATH: "/#/resume",
    UUID_PARAM: "uuid",
    UTM_MEDIUM_PARAM: "utm_medium",
    UTM_MEDIUM_VALUE: "klaviyo_email",
};

const LP_UTM_MEDIUM_QUERY_PARAM = "utm_medium";

const LP_KLAVIYO_PROPERTIES = {
    PAYMENT_COMPLETED: "payment completed",
    PAYMENT_INITIATED: "payment initiated",
    ASSESSMENT_STATUS: "assessment status",
    QUESTION_NUMBER: "question number",
    LANDING_PAGE_NAME: "Landing Page Name",
    AGE: "Age",
    COUNTRY: "Country",
    EMAIL: "Email",
    NAME: "Name",
    ASSESSMENT_ID: "assessmentId",
    FUNNEL_STAGE: "funnel_stage",
    RESUME_URL: "resume_url",
    MAIN_CATEGORY: "mainCategory",
    EVENT_ASSESSMENT_STATUS: "assessmentStatus",
    STAGE: "stage",
    SOURCE: "source",
    CAMPAIGN: "campaign",
    MEDIUM: "medium",
    RESET_PASSWORD: "BAZZINGO:RESET_PASSWORD",
};

const LP_KLAVIYO_EVENT_IDS = {
    EMAIL_CAPTURED: "LandingPageEmailCaptured",
    PAYMENT_INITIATED: "LandingPagePaymentInitiated",
    PAYMENT_COMPLETED: "LandingPagePaymentCompleted",
    ASSESSMENT_COMPLETED: "LandingPageAssessmentCompleted",
    RESUMED: "Resumed",
    SUBSCRIPTION_ACTIVATED: "SubscriptionActivated",
    STANDARD_PLAN_ACTIVATED: "StandardPlanActivated",
    ASSESSMENT_PURCHASED: "AssessmentPurchased",
    EMAIL_FLOW_PAYMENT_INITIATED: "LandingPageEmailFlowPaymentInitiated",
    EMAIL_FLOW_PAYMENT_COMPLETED: "LandingPageEmailFlowPaymentCompleted",
};

const LP_KLAVIYO_SUBSCRIPTION_PROPERTIES = {
    PLAN_NAME: "Current Plan name",
    PLAN_DURATION: "Current Plan duration",
    PLAN_STATUS: "Current Plan status",
    PLAN_START_DATE: "Plan start Date",
    PLAN_END_DATE: "Plan end date",
    SUBSCRIPTION_ID: "Stripe subscription id",
    TRIAL_START_DATE: "Trial period start date",
    TRIAL_END_DATE: "Trial period end date",
    CADENCE: "Monthly or Yearly",
    NEXT_BILLING_DATE: "Next billing date",
    CANCEL_REASON: "bazingo-cancel reason",
    WOULD_HAVE_STAYED: "bazingo-would have you stayed if offered",
};

const LP_KLAVIYO_PURCHASE_PROPERTIES = {
    LAST_PURCHASED_NAME: "Last Purchased Assessment Name",
    LAST_PURCHASED_DATE: "Last Purchased Assessment Date",
};

const LP_KLAVIYO_PROPERTY_BUILDERS = {
    totalPurchased: (mainCategory) => `total purchased ${mainCategory}`,
};

const LP_KLAVIYO_SUBSCRIPTION_STATUS_MAP = {
    trialing: "trial",
    active: "active",
    past_due: "in_active",
    unpaid: "in_active",
    incomplete: "in_active",
    canceled: "cancelled",
};

const LP_KLAVIYO_SYNC_REASONS = {
    SUBSCRIPTION_MISSING: "stripeSubscription + subscriptionRecord missing",
    ORDER_FIELDS_MISSING: "missing order userId/assessmentId",
    USER_EMAIL_MISSING: "email missing on user",
    MAIN_CATEGORY_MISSING: "mainCategory missing",
};

const LP_STRIPE_PRICE_EXPAND = ["product"];

const LP_WOULD_HAVE_STAYED_SEPARATOR = ", ";

module.exports = {
    LP_MESSAGES,
    LP_HOOK_UPDATABLE_FIELDS,
    LP_HOOK_SNAPSHOT_FIELDS,
    LP_LEADERBOARD_RANK_FIELDS,
    LP_FUNNEL_STAGES,
    LP_ASSESSMENT_STATUS,
    LP_SYNC_SOURCES,
    LP_SELECT,
    LP_PROGRAM_SCORE,
    LP_RESUME_TOKEN_EXPIRY,
    LP_RESUME_URL,
    LP_UTM_MEDIUM_QUERY_PARAM,
    LP_KLAVIYO_PROPERTIES,
    LP_KLAVIYO_EVENT_IDS,
    LP_KLAVIYO_SUBSCRIPTION_PROPERTIES,
    LP_KLAVIYO_PURCHASE_PROPERTIES,
    LP_KLAVIYO_PROPERTY_BUILDERS,
    LP_KLAVIYO_SUBSCRIPTION_STATUS_MAP,
    LP_KLAVIYO_SYNC_REASONS,
    LP_STRIPE_PRICE_EXPAND,
    LP_WOULD_HAVE_STAYED_SEPARATOR,
};
