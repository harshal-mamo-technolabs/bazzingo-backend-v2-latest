const DASHBOARD_MESSAGES = {
    STATS: "Dashboard stats",
    USER_NOT_FOUND: "User not found",
    RECENT_ACTIVITY: "Recent activity retrieved successfully",
    RECENT_ACTIVITY_FAILED: "Failed to retrieve recent activity",
    DAILY_STREAK_STATUS: "Daily streak status retrieved successfully",
    DAILY_STREAK_STATUS_FAILED: "Failed to retrieve daily streak status",
};

const DASHBOARD_FUNNEL_SCORE_KEYS = {
    "iq-test": "iq",
    "driving-license": "drivingLicense",
};

const DASHBOARD_ACTIVITY_TYPES = {
    GAME: "game",
    ASSESSMENT: "assessment",
};

const DASHBOARD_ASSESSMENT_NAMES = {
    UNKNOWN: "Unknown Assessment",
    QUICK: "Quick Assessment",
    CATEGORY_SUFFIX: " Assessment",
};

const DASHBOARD_SELECT_FIELDS = {
    GAME: "name category",
    FULL_ASSESSMENT: "title mainCategory questions fixedPoint",
    QUICK_ASSESSMENT: "questions",
};

const DASHBOARD_LIMITS = {
    MONTHS_BACK: 2,
    RECENT_GAMES: 2,
    RECENT_ACTIVITIES: 3,
    GAME_MAX_SCORE: 200,
    QUICK_QUESTION_POINTS: 5,
};

module.exports = {
    DASHBOARD_MESSAGES,
    DASHBOARD_FUNNEL_SCORE_KEYS,
    DASHBOARD_ACTIVITY_TYPES,
    DASHBOARD_ASSESSMENT_NAMES,
    DASHBOARD_SELECT_FIELDS,
    DASHBOARD_LIMITS,
};
