const { config } = require("../config");
const { JOB_SCHEDULES, JOB_TIME_ZONE } = require("../constants");
const {
    LeaderboardService,
} = require("../modules/leaderboard/leaderboardService");
const { runDailyChallengeJob } = require("./dailyChallengeJob");
const { runLeaderboardRanksJob } = require("./leaderboardJob");

const initJobs = ({ scheduler, logger }) => {
    if (!config.JOBS_ENABLED) {
        logger.info("Cron jobs are disabled");

        return [];
    }

    const leaderboardService = new LeaderboardService(logger);

    const tasks = [
        scheduler.schedule(JOB_SCHEDULES.LEADERBOARD_RANKS, () =>
            runLeaderboardRanksJob(logger, leaderboardService),
        ),
        scheduler.schedule(
            JOB_SCHEDULES.DAILY_CHALLENGE,
            () => runDailyChallengeJob(logger),
            { timezone: JOB_TIME_ZONE },
        ),
    ];

    logger.info("Cron jobs scheduled", { count: tasks.length });

    void runDailyChallengeJob(logger);

    return tasks;
};

module.exports = { initJobs };
