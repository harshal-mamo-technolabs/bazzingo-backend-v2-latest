const { runLeaderboardRanksJob } = require("../../src/jobs/leaderboardJob");
const {
    LeaderboardService,
} = require("../../src/modules/leaderboard/leaderboardService");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");

const makeLogger = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
});

describe("runLeaderboardRanksJob", () => {
    let logger;

    beforeEach(() => {
        logger = makeLogger();
    });

    describe("given the recompute succeeds", () => {
        it("should call the leaderboard service and log the outcome", async () => {
            const leaderboardService = { recomputeRanks: jest.fn() };

            await runLeaderboardRanksJob(logger, leaderboardService);

            expect(leaderboardService.recomputeRanks).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });
    });

    describe("given the recompute fails", () => {
        it("should log the failure without throwing", async () => {
            const leaderboardService = {
                recomputeRanks: jest
                    .fn()
                    .mockRejectedValue(new Error("mongo is down")),
            };

            await expect(
                runLeaderboardRanksJob(logger, leaderboardService),
            ).resolves.toBeUndefined();
            expect(logger.error).toHaveBeenCalled();
        });
    });
});

describe("LeaderboardService.recomputeRanks", () => {
    useInMemoryDatabase();

    const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

    const seed = async (rows) => {
        for (const row of rows) {
            const user = await createUser({
                email: `${row.name}@bazzingo.com`,
            });

            await Leaderboard.create({
                userId: user._id,
                name: row.name,
                country: row.country,
                ageGroup: row.ageGroup,
                game: { totalScore: row.gameScore, category: {} },
                assessment: { totalScore: row.assessmentScore, category: {} },
                createdAt: anHourAgo(),
            });
        }
    };

    const ranksByName = async () => {
        const rows = await Leaderboard.find({}).lean();

        return Object.fromEntries(rows.map((row) => [row.name, row]));
    };

    it("should rank the global game and assessment boards", async () => {
        await seed([
            { name: "alpha", gameScore: 10, assessmentScore: 30 },
            { name: "bravo", gameScore: 30, assessmentScore: 10 },
            { name: "charlie", gameScore: 20, assessmentScore: 20 },
        ]);

        await new LeaderboardService(makeLogger()).recomputeRanks();

        const ranks = await ranksByName();

        expect(ranks.bravo.gameGlobalRank).toBe(1);
        expect(ranks.charlie.gameGlobalRank).toBe(2);
        expect(ranks.alpha.gameGlobalRank).toBe(3);
        expect(ranks.alpha.assessmentGlobalRank).toBe(1);
        expect(ranks.bravo.assessmentGlobalRank).toBe(3);
    });

    it("should rank within a country and an age group", async () => {
        await seed([
            {
                name: "alpha",
                country: "india",
                ageGroup: "25-34",
                gameScore: 10,
                assessmentScore: 10,
            },
            {
                name: "bravo",
                country: "india",
                ageGroup: "25-34",
                gameScore: 30,
                assessmentScore: 30,
            },
            {
                name: "charlie",
                country: "germany",
                ageGroup: "35-44",
                gameScore: 20,
                assessmentScore: 20,
            },
        ]);

        await new LeaderboardService(makeLogger()).recomputeRanks();

        const ranks = await ranksByName();

        expect(ranks.bravo.gameCountryRank).toBe(1);
        expect(ranks.alpha.gameCountryRank).toBe(2);
        expect(ranks.charlie.gameCountryRank).toBe(1);
        expect(ranks.bravo.assessmentAgeGroupRank).toBe(1);
        expect(ranks.charlie.assessmentAgeGroupRank).toBe(1);
    });

    it("should skip rows younger than thirty minutes", async () => {
        const user = await createUser({ email: "fresh@bazzingo.com" });

        await Leaderboard.create({
            userId: user._id,
            name: "fresh",
            gameGlobalRank: 7,
            game: { totalScore: 100, category: {} },
            assessment: { totalScore: 100, category: {} },
        });

        await new LeaderboardService(makeLogger()).recomputeRanks();

        const ranks = await ranksByName();

        expect(ranks.fresh.gameGlobalRank).toBe(7);
    });
});
