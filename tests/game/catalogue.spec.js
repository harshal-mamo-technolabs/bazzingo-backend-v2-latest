const request = require("supertest");
const app = require("../../src/app");
const Game = require("../../src/modules/game/gameModel");
const { useInMemoryDatabase } = require("../utils/db");
const {
    createAdmin,
    createUser,
    getAdminToken,
    getAccessToken,
} = require("../utils/fixtures");
const { createGame } = require("../utils/gameFixtures");

describe("POST /game/games", () => {
    useInMemoryDatabase();

    let superadminToken;

    beforeEach(async () => {
        const admin = await createAdmin({ role: "superadmin" });
        superadminToken = getAdminToken(admin._id);
    });

    const validBody = {
        name: "Logic Puzzle",
        category: "Logic",
        url: "https://games.bazzingo.com/logic",
        thumbnail: "logic.png",
    };

    const create = (body = validBody, token = superadminToken) =>
        request(app)
            .post("/game/games")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    describe("given a superadmin token", () => {
        it("should return a 201 status code", async () => {
            const response = await create();

            expect(response.statusCode).toBe(201);
        });

        it("should return the success envelope", async () => {
            const response = await create();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Game created");
        });

        it("should persist the game", async () => {
            await create();

            const game = await Game.findOne({ name: "Logic Puzzle" });
            expect(game.category).toBe("Logic");
            expect(game.url).toBe("https://games.bazzingo.com/logic");
            expect(game.thumbnail).toBe("logic.png");
        });

        it("should default isActive to true", async () => {
            await create();

            const game = await Game.findOne({ name: "Logic Puzzle" });
            expect(game.isActive).toBe(true);
        });

        it("should honour an explicit isActive", async () => {
            await create({ ...validBody, isActive: false });

            const game = await Game.findOne({ name: "Logic Puzzle" });
            expect(game.isActive).toBe(false);
        });

        it("should return a 400 when the name is missing", async () => {
            const { name, ...body } = validBody;

            const response = await create(body);

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "name, category and url are required",
            );
        });

        it("should return a 400 when the category is missing", async () => {
            const { category, ...body } = validBody;

            expect((await create(body)).statusCode).toBe(400);
        });

        it("should return a 400 when the url is missing", async () => {
            const { url, ...body } = validBody;

            expect((await create(body)).statusCode).toBe(400);
        });

        it("should not persist anything when the body is rejected", async () => {
            await create({ name: "Only a name" });

            expect(await Game.countDocuments()).toBe(0);
        });
    });

    describe("given a token that may not create games", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post("/game/games")
                .send(validBody);

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 for a user token", async () => {
            const user = await createUser();

            const response = await create(validBody, getAccessToken(user._id));

            expect(response.statusCode).toBe(401);
        });

        it("should return a 403 for a non superadmin admin", async () => {
            const manager = await createAdmin({
                email: "manager@bazzingo.com",
                role: "manager",
            });

            const response = await create(
                validBody,
                getAdminToken(manager._id),
            );

            expect(response.statusCode).toBe(403);
            expect(response.body.message).toBe(
                "Forbidden: Insufficient privileges",
            );
        });
    });
});

describe("GET /game/games", () => {
    useInMemoryDatabase();

    const listGames = () => request(app).get("/game/games");

    it("should return a 200 status code without a token", async () => {
        const response = await listGames();

        expect(response.statusCode).toBe(200);
    });

    it("should return the success envelope", async () => {
        const response = await listGames();

        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Games");
    });

    it("should return the active games", async () => {
        await createGame();

        const response = await listGames();

        expect(response.body.data.games).toHaveLength(1);
        expect(response.body.data.games[0].name).toBe("Logic Puzzle");
    });

    it("should hide inactive games", async () => {
        await createGame({ isActive: false });

        const response = await listGames();

        expect(response.body.data.games).toHaveLength(0);
    });

    it("should return the newest game first", async () => {
        await createGame({
            name: "Older",
            createdAt: new Date("2026-01-01"),
        });
        await createGame({
            name: "Newer",
            createdAt: new Date("2026-02-01"),
        });

        const response = await listGames();

        expect(response.body.data.games[0].name).toBe("Newer");
    });
});

describe("GET /game/games/stats", () => {
    useInMemoryDatabase();

    let token;

    beforeEach(async () => {
        const user = await createUser();
        token = getAccessToken(user._id);
    });

    const getStats = (accessToken = token) =>
        request(app)
            .get("/game/games/stats")
            .set("Authorization", `Bearer ${accessToken}`);

    it("should return a 200 status code", async () => {
        const response = await getStats();

        expect(response.statusCode).toBe(200);
    });

    it("should return the success envelope", async () => {
        const response = await getStats();

        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Games stats");
    });

    it("should count every game, including inactive ones", async () => {
        await createGame();
        await createGame({ name: "Hidden", isActive: false });

        const response = await getStats();

        expect(response.body.data.total).toBe(2);
    });

    it("should group the counts by category", async () => {
        await createGame({ category: "Logic" });
        await createGame({ name: "Memory Game", category: "Memory" });
        await createGame({ name: "Another Logic", category: "Logic" });

        const response = await getStats();

        expect(response.body.data.byCategory).toEqual([
            { category: "Logic", count: 2 },
            { category: "Memory", count: 1 },
        ]);
    });

    it("should return zero and an empty list when there are no games", async () => {
        const response = await getStats();

        expect(response.body.data.total).toBe(0);
        expect(response.body.data.byCategory).toEqual([]);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/game/games/stats");

        expect(response.statusCode).toBe(401);
    });
});
