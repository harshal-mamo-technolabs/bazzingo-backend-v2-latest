const JOB_SCHEDULES = {
    LEADERBOARD_RANKS: "*/15 * * * *",
    DAILY_CHALLENGE: "0 */12 * * *",
};

const JOB_TIME_ZONE = "Europe/Berlin";

const DAILY_CHALLENGE_DIFFICULTIES = ["easy", "hard", "moderate"];

const DAILY_CHALLENGE_GAME_COUNT = 3;

const LEADERBOARD_RANK_RECOMPUTE = {
    MIN_AGE_MS: 30 * 60 * 1000,
    BATCH_SIZE: 1000,
    SELECT: "_id game.totalScore assessment.totalScore country ageGroup",
};

const LEADERBOARD_RANK_SORTS = {
    GAME: { "game.totalScore": -1, updatedAt: 1 },
    ASSESSMENT: { "assessment.totalScore": -1, updatedAt: 1 },
};

module.exports = {
    JOB_SCHEDULES,
    JOB_TIME_ZONE,
    DAILY_CHALLENGE_DIFFICULTIES,
    DAILY_CHALLENGE_GAME_COUNT,
    LEADERBOARD_RANK_RECOMPUTE,
    LEADERBOARD_RANK_SORTS,
};
