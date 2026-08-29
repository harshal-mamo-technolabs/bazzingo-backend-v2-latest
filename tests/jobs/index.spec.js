jest.mock("../../src/jobs/dailyChallengeJob", () => ({
    runDailyChallengeJob: jest.fn().mockResolvedValue(null),
}));
jest.mock("../../src/jobs/leaderboardJob", () => ({
    runLeaderboardRanksJob: jest.fn().mockResolvedValue(undefined),
}));

const { initJobs } = require("../../src/jobs");
const { config } = require("../../src/config");
const { runDailyChallengeJob } = require("../../src/jobs/dailyChallengeJob");
const { runLeaderboardRanksJob } = require("../../src/jobs/leaderboardJob");

const makeLogger = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
});

describe("initJobs", () => {
    let logger;
    let scheduler;

    beforeEach(() => {
        jest.clearAllMocks();
        logger = makeLogger();
        scheduler = { schedule: jest.fn(() => ({ stop: jest.fn() })) };
        config.JOBS_ENABLED = false;
    });

    afterEach(() => {
        config.JOBS_ENABLED = false;
    });

    describe("given JOBS_ENABLED is off", () => {
        it("should not schedule anything", () => {
            const tasks = initJobs({ scheduler, logger });

            expect(scheduler.schedule).not.toHaveBeenCalled();
            expect(runDailyChallengeJob).not.toHaveBeenCalled();
            expect(tasks).toEqual([]);
        });
    });

    describe("given JOBS_ENABLED is on", () => {
        beforeEach(() => {
            config.JOBS_ENABLED = true;
        });

        it("should schedule both jobs with the v1 expressions", () => {
            initJobs({ scheduler, logger });

            const expressions = scheduler.schedule.mock.calls.map(
                (call) => call[0],
            );

            expect(expressions).toEqual(["*/15 * * * *", "0 */12 * * *"]);
        });

        it("should schedule the daily challenge in the CET timezone", () => {
            initJobs({ scheduler, logger });

            expect(scheduler.schedule.mock.calls[1][2]).toEqual({
                timezone: "Europe/Berlin",
            });
        });

        it("should run the daily challenge once on boot", () => {
            initJobs({ scheduler, logger });

            expect(runDailyChallengeJob).toHaveBeenCalledTimes(1);
        });

        it("should delegate the scheduled ticks to the job bodies", async () => {
            initJobs({ scheduler, logger });

            await scheduler.schedule.mock.calls[0][1]();
            await scheduler.schedule.mock.calls[1][1]();

            expect(runLeaderboardRanksJob).toHaveBeenCalledTimes(1);
            expect(runDailyChallengeJob).toHaveBeenCalledTimes(2);
        });

        it("should return the scheduled tasks", () => {
            const tasks = initJobs({ scheduler, logger });

            expect(tasks).toHaveLength(2);
        });
    });
});
