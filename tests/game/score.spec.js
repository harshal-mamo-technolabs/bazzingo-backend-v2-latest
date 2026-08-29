const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../src/app");
const GameScore = require("../../src/modules/game/gameScoreModel");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const UserDailyActivity = require("../../src/modules/streak/userDailyActivityModel");
const Badge = require("../../src/modules/badge/badgeModel");
const BadgeUnlock = require("../../src/modules/badge/badgeUnlockModel");
const { badges } = require("../../src/modules/badge/badgeData");
const { getCETMidnight } = require("../../src/common/utils/time");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const { createGame, createTodaysChallenge } = require("../utils/gameFixtures");

describe("POST /game/score", () => {
    useInMemoryDatabase();

    let user;
    let token;
    let game;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
        game = await createGame();
    });

    const submitScore = (body, accessToken = token) =>
        request(app)
            .post("/game/score")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    const suggestToday = () => createTodaysChallenge([game]);

    describe("given a suggested game and a positive score", () => {
        beforeEach(async () => {
            await suggestToday();
        });

        it("should return a 201 status code", async () => {
            const response = await submitScore({
                gameId: String(game._id),
                score: 120,
            });

            expect(response.statusCode).toBe(201);
        });

        it("should return the success envelope", async () => {
            const response = await submitScore({
                gameId: String(game._id),
                score: 120,
            });

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Score recorded");
        });

        it("should persist the score against today", async () => {
            await submitScore({ gameId: String(game._id), score: 120 });

            const score = await GameScore.findOne({ userId: user._id });
            expect(score.score).toBe(120);
            expect(score.suggestedDate.toISOString()).toBe(
                getCETMidnight(new Date()).toISOString(),
            );
        });

        it("should add the score to the leaderboard category total", async () => {
            await Leaderboard.create({
                userId: user._id,
                game: { totalScore: 30, category: {} },
            });

            await submitScore({ gameId: String(game._id), score: 120 });

            const row = await Leaderboard.findOne({ userId: user._id });
            expect(row.game.totalScore).toBe(150);
            expect(row.game.category.get("Logic")).toBe(120);
        });

        it("should accumulate a category total across submissions", async () => {
            const second = await createGame({ name: "Second Logic" });
            await createTodaysChallenge([game, second]);
            await Leaderboard.create({
                userId: user._id,
                game: { totalScore: 0, category: {} },
            });

            await submitScore({ gameId: String(game._id), score: 100 });
            await submitScore({ gameId: String(second._id), score: 40 });

            const row = await Leaderboard.findOne({ userId: user._id });
            expect(row.game.category.get("Logic")).toBe(140);
        });

        it("should mark the day as played", async () => {
            await submitScore({ gameId: String(game._id), score: 120 });

            const activity = await UserDailyActivity.findOne({
                userId: user._id,
            });
            expect(activity.isGamePlayed).toBe(true);
            expect(activity.date.toISOString()).toBe(
                getCETMidnight(new Date()).toISOString(),
            );
        });

        it("should not create a second activity row for the same day", async () => {
            const second = await createGame({ name: "Second Logic" });
            await createTodaysChallenge([game, second]);

            await submitScore({ gameId: String(game._id), score: 120 });
            await submitScore({ gameId: String(second._id), score: 10 });

            expect(
                await UserDailyActivity.countDocuments({ userId: user._id }),
            ).toBe(1);
        });

        it("should unlock the badges the score earns", async () => {
            await Badge.insertMany(badges);
            const games = [];
            for (let i = 0; i < 10; i += 1) {
                const extra = await createGame({ name: `Extra ${i}` });
                games.push(extra);
                await GameScore.create({
                    userId: user._id,
                    gameId: extra._id,
                    score: 10,
                    suggestedDate: new Date(Date.now() - (i + 1) * 86400000),
                });
            }

            await submitScore({ gameId: String(game._id), score: 120 });

            const unlocks = await BadgeUnlock.find({
                userId: user._id,
            }).populate("badgeId");
            expect(unlocks.map((u) => u.badgeId.name)).toContain(
                "game-explorer",
            );
        });

        it("should still record the score when badge checking fails", async () => {
            const spy = jest.spyOn(Badge, "find").mockImplementationOnce(() => {
                throw new Error("badges are down");
            });

            const response = await submitScore({
                gameId: String(game._id),
                score: 120,
            });

            expect(response.statusCode).toBe(201);
            expect(await GameScore.countDocuments({ userId: user._id })).toBe(
                1,
            );
            spy.mockRestore();
        });
    });

    describe("given a score of zero or less", () => {
        beforeEach(async () => {
            await suggestToday();
        });

        it("should return a 200 status code", async () => {
            const response = await submitScore({
                gameId: String(game._id),
                score: 0,
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe("Score 0 cannot be recorded");
        });

        it("should not persist a zero score", async () => {
            await submitScore({ gameId: String(game._id), score: 0 });

            expect(await GameScore.countDocuments()).toBe(0);
        });

        it("should not persist a negative score", async () => {
            const response = await submitScore({
                gameId: String(game._id),
                score: -5,
            });

            expect(response.statusCode).toBe(200);
            expect(await GameScore.countDocuments()).toBe(0);
        });
    });

    describe("given an invalid request", () => {
        it("should return a 400 when gameId is missing", async () => {
            const response = await submitScore({ score: 10 });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "gameId and numeric score are required",
            );
        });

        it("should return a 400 when the score is not a number", async () => {
            const response = await submitScore({
                gameId: String(game._id),
                score: "120",
            });

            expect(response.statusCode).toBe(400);
        });

        it("should return a 404 for an unknown game", async () => {
            const response = await submitScore({
                gameId: String(new mongoose.Types.ObjectId()),
                score: 10,
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe("Game not found");
        });

        it("should return a 404 for an inactive game", async () => {
            const inactive = await createGame({
                name: "Inactive",
                isActive: false,
            });

            const response = await submitScore({
                gameId: String(inactive._id),
                score: 10,
            });

            expect(response.statusCode).toBe(404);
        });

        it("should return a 400 when the game is not suggested today", async () => {
            const response = await submitScore({
                gameId: String(game._id),
                score: 10,
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Game not suggested today");
        });

        it("should return a 400 on a second score for the same game today", async () => {
            await suggestToday();
            await submitScore({ gameId: String(game._id), score: 10 });

            const response = await submitScore({
                gameId: String(game._id),
                score: 20,
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Score for this game was already recorded today",
            );
        });

        it("should keep only the first score of the day", async () => {
            await suggestToday();
            await submitScore({ gameId: String(game._id), score: 10 });
            await submitScore({ gameId: String(game._id), score: 20 });

            const scores = await GameScore.find({ userId: user._id });
            expect(scores).toHaveLength(1);
            expect(scores[0].score).toBe(10);
        });

        it("should return a 401 without a token", async () => {
            const response = await request(app).post("/game/score").send({});

            expect(response.statusCode).toBe(401);
        });
    });
});

describe("GET /game/stats/weekly-scores", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const weeklyScores = () =>
        request(app)
            .get("/game/stats/weekly-scores")
            .set("Authorization", `Bearer ${token}`);

    it("should return the success envelope", async () => {
        const response = await weeklyScores();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Current week daily scores");
    });

    it("should return the seven days starting on Monday", async () => {
        const response = await weeklyScores();

        expect(Object.keys(response.body.data.scores)).toEqual([
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
            "SUNDAY",
        ]);
    });

    it("should default every day to zero", async () => {
        const response = await weeklyScores();

        expect(Object.values(response.body.data.scores)).toEqual([
            0, 0, 0, 0, 0, 0, 0,
        ]);
    });

    it("should sum today's scores into today's bucket", async () => {
        const game = await createGame();
        const second = await createGame({ name: "Second" });
        await GameScore.create({
            userId: user._id,
            gameId: game._id,
            score: 30,
            suggestedDate: new Date(),
            playedAt: new Date(),
        });
        await GameScore.create({
            userId: user._id,
            gameId: second._id,
            score: 12,
            suggestedDate: new Date(),
            playedAt: new Date(),
        });

        const response = await weeklyScores();

        const dayNames = [
            "SUNDAY",
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
        ];
        const today = dayNames[new Date().getDay()];
        expect(response.body.data.scores[today]).toBe(42);
    });

    it("should ignore another user's scores", async () => {
        const game = await createGame();
        const other = await createUser({ email: "other@bazzingo.com" });
        await GameScore.create({
            userId: other._id,
            gameId: game._id,
            score: 30,
            suggestedDate: new Date(),
            playedAt: new Date(),
        });

        const response = await weeklyScores();

        expect(Object.values(response.body.data.scores)).toEqual([
            0, 0, 0, 0, 0, 0, 0,
        ]);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/game/stats/weekly-scores");

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /game/statistics", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const statistics = () =>
        request(app)
            .get("/game/statistics")
            .set("Authorization", `Bearer ${token}`);

    it("should return the success envelope", async () => {
        const response = await statistics();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Game statistics retrieved successfully",
        );
    });

    it("should return all six time periods", async () => {
        const response = await statistics();

        expect(Object.keys(response.body.data.statistics)).toEqual([
            "today",
            "last7Days",
            "last1Month",
            "last3Months",
            "last6Months",
            "last1Year",
        ]);
    });

    it("should default the rank to 1 without a leaderboard row", async () => {
        const response = await statistics();

        expect(response.body.data.rank).toBe(1);
    });

    it("should use the leaderboard rank when there is one", async () => {
        await Leaderboard.create({ userId: user._id, gameGlobalRank: 7 });

        const response = await statistics();

        expect(response.body.data.rank).toBe(7);
        expect(response.body.data.statistics.today.rank).toBe(7);
    });

    it("should total today's scores by category", async () => {
        const game = await createGame();
        await GameScore.create({
            userId: user._id,
            gameId: game._id,
            score: 40,
            suggestedDate: new Date(),
            playedAt: new Date(),
        });

        const response = await statistics();

        const today = response.body.data.statistics.today;
        expect(today.totalScore).toBe(40);
        expect(today.statistics.Logic).toBe(40);
        expect(today.totalGamePlayed).toBe(1);
    });

    it("should seed every active category at zero", async () => {
        await createGame({ category: "Logic" });
        await createGame({ name: "Memory Game", category: "Memory" });

        const response = await statistics();

        expect(response.body.data.statistics.today.statistics).toEqual({
            Logic: 0,
            Memory: 0,
        });
    });

    it("should compute the brain index as the score over the category count", async () => {
        const game = await createGame({ category: "Logic" });
        await createGame({ name: "Memory Game", category: "Memory" });
        await GameScore.create({
            userId: user._id,
            gameId: game._id,
            score: 50,
            suggestedDate: new Date(),
            playedAt: new Date(),
        });

        const response = await statistics();

        expect(response.body.data.statistics.today.categoryCount).toBe(2);
        expect(response.body.data.statistics.today.brainIndex).toBe(25);
    });

    it("should return a zero brain index when there are no categories", async () => {
        const response = await statistics();

        expect(response.body.data.statistics.today.brainIndex).toBe(0);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/game/statistics");

        expect(response.statusCode).toBe(401);
    });
});
