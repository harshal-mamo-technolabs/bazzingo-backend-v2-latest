const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../src/app");
const GamePlay = require("../../src/modules/game/gamePlayModel");
const GameScore = require("../../src/modules/game/gameScoreModel");
const { getCETMidnight } = require("../../src/common/utils/time");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const { createGame, createTodaysChallenge } = require("../utils/gameFixtures");

describe("POST /game/play", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const trackPlay = (body, accessToken = token) =>
        request(app)
            .post("/game/play")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    describe("given a playable game", () => {
        it("should return a 201 status code", async () => {
            const game = await createGame();

            const response = await trackPlay({ gameId: String(game._id) });

            expect(response.statusCode).toBe(201);
        });

        it("should return the success envelope", async () => {
            const game = await createGame();

            const response = await trackPlay({ gameId: String(game._id) });

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Play tracked");
        });

        it("should persist the play for the caller", async () => {
            const game = await createGame();

            await trackPlay({ gameId: String(game._id) });

            const play = await GamePlay.findOne({ userId: user._id });
            expect(String(play.gameId)).toBe(String(game._id));
        });

        it("should flag a play that came from today's challenge", async () => {
            const game = await createGame();
            await createTodaysChallenge([game]);

            await trackPlay({ gameId: String(game._id) });

            const play = await GamePlay.findOne({ userId: user._id });
            expect(play.viaSuggestion).toBe(true);
        });

        it("should not flag a play outside today's challenge", async () => {
            const game = await createGame();

            await trackPlay({ gameId: String(game._id) });

            const play = await GamePlay.findOne({ userId: user._id });
            expect(play.viaSuggestion).toBe(false);
        });

        it("should allow the same game to be played twice", async () => {
            const game = await createGame();

            await trackPlay({ gameId: String(game._id) });
            await trackPlay({ gameId: String(game._id) });

            expect(await GamePlay.countDocuments({ userId: user._id })).toBe(2);
        });
    });

    describe("given an unplayable game", () => {
        it("should return a 400 when gameId is missing", async () => {
            const response = await trackPlay({});

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("gameId is required");
        });

        it("should return a 404 for an unknown game", async () => {
            const response = await trackPlay({
                gameId: String(new mongoose.Types.ObjectId()),
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe("Game not found");
        });

        it("should return a 404 for an inactive game", async () => {
            const game = await createGame({ isActive: false });

            const response = await trackPlay({ gameId: String(game._id) });

            expect(response.statusCode).toBe(404);
        });

        it("should not persist a play when the game is rejected", async () => {
            await trackPlay({
                gameId: String(new mongoose.Types.ObjectId()),
            });

            expect(await GamePlay.countDocuments()).toBe(0);
        });

        it("should return a 401 without a token", async () => {
            const response = await request(app).post("/game/play").send({});

            expect(response.statusCode).toBe(401);
        });
    });
});

describe("GET /game/recent", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const recentlyPlayed = () =>
        request(app)
            .get("/game/recent")
            .set("Authorization", `Bearer ${token}`);

    it("should return a 200 status code", async () => {
        const response = await recentlyPlayed();

        expect(response.statusCode).toBe(200);
    });

    it("should return the success envelope", async () => {
        const response = await recentlyPlayed();

        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Recently played");
    });

    it("should return the game with its last played time", async () => {
        const game = await createGame();
        await GamePlay.create({ userId: user._id, gameId: game._id });

        const response = await recentlyPlayed();

        expect(response.body.data.plays).toHaveLength(1);
        expect(response.body.data.plays[0].game.name).toBe("Logic Puzzle");
        expect(response.body.data.plays[0].lastPlayedAt).toBeTruthy();
    });

    it("should return one entry per game, not per play", async () => {
        const game = await createGame();
        await GamePlay.create({ userId: user._id, gameId: game._id });
        await GamePlay.create({ userId: user._id, gameId: game._id });

        const response = await recentlyPlayed();

        expect(response.body.data.plays).toHaveLength(1);
    });

    it("should order by the most recent play", async () => {
        const older = await createGame({ name: "Older" });
        const newer = await createGame({ name: "Newer" });
        await GamePlay.create({
            userId: user._id,
            gameId: older._id,
            playedAt: new Date("2026-01-01"),
        });
        await GamePlay.create({
            userId: user._id,
            gameId: newer._id,
            playedAt: new Date("2026-02-01"),
        });

        const response = await recentlyPlayed();

        expect(response.body.data.plays.map((p) => p.game.name)).toEqual([
            "Newer",
            "Older",
        ]);
    });

    it("should not return another user's plays", async () => {
        const game = await createGame();
        const other = await createUser({ email: "other@bazzingo.com" });
        await GamePlay.create({ userId: other._id, gameId: game._id });

        const response = await recentlyPlayed();

        expect(response.body.data.plays).toEqual([]);
    });

    it("should cap the list at 20 games", async () => {
        for (let i = 0; i < 22; i += 1) {
            const game = await createGame({ name: `Game ${i}` });
            await GamePlay.create({ userId: user._id, gameId: game._id });
        }

        const response = await recentlyPlayed();

        expect(response.body.data.plays).toHaveLength(20);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/game/recent");

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /game/stats/unique-games", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const uniqueGames = () =>
        request(app)
            .get("/game/stats/unique-games")
            .set("Authorization", `Bearer ${token}`);

    it("should return the success envelope", async () => {
        const response = await uniqueGames();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Unique games count");
    });

    it("should count distinct games, not plays", async () => {
        const game = await createGame();
        const other = await createGame({ name: "Other" });
        await GamePlay.create({ userId: user._id, gameId: game._id });
        await GamePlay.create({ userId: user._id, gameId: game._id });
        await GamePlay.create({ userId: user._id, gameId: other._id });

        const response = await uniqueGames();

        expect(response.body.data.count).toBe(2);
    });

    it("should return 0 when the user has never played", async () => {
        const response = await uniqueGames();

        expect(response.body.data.count).toBe(0);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/game/stats/unique-games");

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /game/suggestions/daily", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const getSuggestions = () =>
        request(app)
            .get("/game/suggestions/daily")
            .set("Authorization", `Bearer ${token}`);

    it("should return a null suggestion when there is no challenge today", async () => {
        const response = await getSuggestions();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("No daily suggestions found");
        expect(response.body.data.suggestion).toBeNull();
    });

    it("should return today's challenge with its games", async () => {
        const game = await createGame();
        await createTodaysChallenge([game]);

        const response = await getSuggestions();

        expect(response.body.message).toBe("Daily suggestions");
        expect(response.body.data.suggestion.games).toHaveLength(1);
        expect(response.body.data.suggestion.games[0].gameId.name).toBe(
            "Logic Puzzle",
        );
    });

    it("should mark a game the user has not played as unplayed", async () => {
        const game = await createGame();
        await createTodaysChallenge([game]);

        const response = await getSuggestions();

        expect(response.body.data.suggestion.games[0].isPlayed).toBe(false);
    });

    it("should mark a game scored today as played", async () => {
        const game = await createGame();
        await createTodaysChallenge([game]);
        await GameScore.create({
            userId: user._id,
            gameId: game._id,
            score: 50,
            suggestedDate: getCETMidnight(new Date()),
        });

        const response = await getSuggestions();

        expect(response.body.data.suggestion.games[0].isPlayed).toBe(true);
    });

    it("should not count another user's score as played", async () => {
        const game = await createGame();
        await createTodaysChallenge([game]);
        const other = await createUser({ email: "other@bazzingo.com" });
        await GameScore.create({
            userId: other._id,
            gameId: game._id,
            score: 50,
            suggestedDate: getCETMidnight(new Date()),
        });

        const response = await getSuggestions();

        expect(response.body.data.suggestion.games[0].isPlayed).toBe(false);
    });

    it("should keep the difficulty of each suggested game", async () => {
        const game = await createGame();
        await createTodaysChallenge([game]);

        const response = await getSuggestions();

        expect(response.body.data.suggestion.games[0].difficulty).toBe("easy");
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/game/suggestions/daily");

        expect(response.statusCode).toBe(401);
    });
});
