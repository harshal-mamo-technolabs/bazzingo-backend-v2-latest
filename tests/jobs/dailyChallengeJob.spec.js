const { runDailyChallengeJob } = require("../../src/jobs/dailyChallengeJob");
const { getCETMidnight } = require("../../src/common/utils/time");
const DailyChallenge = require("../../src/modules/game/dailyChallengeModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createGame, createQuickAssessment } = require("../utils/gameFixtures");

const makeLogger = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
});

describe("runDailyChallengeJob", () => {
    useInMemoryDatabase();

    let logger;

    beforeEach(() => {
        logger = makeLogger();
        jest.restoreAllMocks();
    });

    describe("given active games and quick assessments", () => {
        beforeEach(async () => {
            await Promise.all([
                createGame(),
                createGame({ name: "Memory Match", category: "Memory" }),
                createGame({ name: "Reflex Rush", category: "Reflex" }),
                createGame({ name: "Word Wall", category: "Verbal" }),
            ]);
            await createQuickAssessment();
        });

        it("should create today's challenge", async () => {
            await runDailyChallengeJob(logger);

            const challenge = await DailyChallenge.findOne({
                date: getCETMidnight(new Date()),
            }).lean();

            expect(challenge).not.toBeNull();
        });

        it("should pick three games with the v1 difficulty rotation", async () => {
            const challenge = await runDailyChallengeJob(logger);

            expect(challenge.games.map((game) => game.difficulty)).toEqual([
                "easy",
                "hard",
                "moderate",
            ]);
        });

        it("should start at cycle one", async () => {
            const challenge = await runDailyChallengeJob(logger);

            expect(challenge.cycleNumber).toBe(1);
        });

        it("should be idempotent for the same day", async () => {
            const first = await runDailyChallengeJob(logger);
            const second = await runDailyChallengeJob(logger);

            expect(String(second._id)).toBe(String(first._id));
            expect(await DailyChallenge.countDocuments({})).toBe(1);
        });
    });

    describe("given no active games", () => {
        it("should skip and warn without creating a challenge", async () => {
            await createQuickAssessment();

            const result = await runDailyChallengeJob(logger);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalled();
            expect(await DailyChallenge.countDocuments({})).toBe(0);
        });
    });

    describe("given no active quick assessments", () => {
        it("should skip and warn without creating a challenge", async () => {
            await createGame();

            const result = await runDailyChallengeJob(logger);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe("given the database read fails", () => {
        it("should log the failure without throwing", async () => {
            jest.spyOn(DailyChallenge, "findOne").mockImplementation(() => {
                throw new Error("mongo is down");
            });

            await expect(runDailyChallengeJob(logger)).resolves.toBeNull();
            expect(logger.error).toHaveBeenCalled();
        });
    });
});
