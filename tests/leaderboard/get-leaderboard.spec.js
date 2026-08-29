const request = require("supertest");
const app = require("../../src/app");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

describe("GET /leaderboard", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const addRow = async (overrides = {}) =>
        await Leaderboard.create({
            userId: overrides.userId || user._id,
            name: "Harshal",
            country: "india",
            ageGroup: "25-34",
            gameGlobalRank: 1,
            gameCountryRank: 1,
            gameAgeGroupRank: 1,
            game: { totalScore: 100, category: {} },
            assessment: { totalScore: 50, category: {} },
            ...overrides,
        });

    const getLeaderboard = (query = "") =>
        request(app)
            .get(`/leaderboard${query}`)
            .set("Authorization", `Bearer ${token}`);

    describe("scope=global", () => {
        it("should return a 200 status code", async () => {
            await addRow();

            const response = await getLeaderboard();

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            const response = await getLeaderboard();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Leaderboard");
        });

        it("should default to the global scope with page 1 and limit 20", async () => {
            const response = await getLeaderboard();

            expect(response.body.data.scope).toBe("global");
            expect(response.body.data.page).toBe(1);
            expect(response.body.data.limit).toBe(20);
        });

        it("should order rows by gameGlobalRank", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await addRow({ gameGlobalRank: 2, name: "Second" });
            await addRow({
                userId: other._id,
                gameGlobalRank: 1,
                name: "First",
            });

            const response = await getLeaderboard();

            expect(response.body.data.results.map((r) => r.name)).toEqual([
                "First",
                "Second",
            ]);
        });

        it("should return the total row count", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await addRow();
            await addRow({ userId: other._id });

            const response = await getLeaderboard();

            expect(response.body.data.total).toBe(2);
        });

        it("should return the caller's own row as currentUser", async () => {
            await addRow({ name: "Harshal" });

            const response = await getLeaderboard();

            expect(response.body.data.currentUser.name).toBe("Harshal");
        });

        it("should return a null currentUser when the caller has no row", async () => {
            const response = await getLeaderboard();

            expect(response.body.data.currentUser).toBeNull();
        });

        it("should exclude soft deleted rows", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await addRow();
            await addRow({ userId: other._id, isDeleted: true });

            const response = await getLeaderboard();

            expect(response.body.data.total).toBe(1);
            expect(response.body.data.results).toHaveLength(1);
        });
    });

    describe("pagination", () => {
        it("should honour page and limit", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await addRow({ gameGlobalRank: 1, name: "First" });
            await addRow({
                userId: other._id,
                gameGlobalRank: 2,
                name: "Second",
            });

            const response = await getLeaderboard("?page=2&limit=1");

            expect(response.body.data.page).toBe(2);
            expect(response.body.data.limit).toBe(1);
            expect(response.body.data.results.map((r) => r.name)).toEqual([
                "Second",
            ]);
        });

        it("should clamp the limit to 100", async () => {
            const response = await getLeaderboard("?limit=500");

            expect(response.body.data.limit).toBe(100);
        });

        it("should treat limit=0 as unset and use the default", async () => {
            const response = await getLeaderboard("?limit=0");

            expect(response.body.data.limit).toBe(20);
        });

        it("should clamp a negative limit up to 1", async () => {
            const response = await getLeaderboard("?limit=-5");

            expect(response.body.data.limit).toBe(1);
        });

        it("should clamp a page below 1 up to 1", async () => {
            const response = await getLeaderboard("?page=0");

            expect(response.body.data.page).toBe(1);
        });

        it("should fall back to the defaults for non numeric values", async () => {
            const response = await getLeaderboard("?page=abc&limit=xyz");

            expect(response.body.data.page).toBe(1);
            expect(response.body.data.limit).toBe(20);
        });
    });

    describe("scope=country", () => {
        it("should filter by the lowercased country", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await addRow({ country: "india", name: "Indian" });
            await addRow({
                userId: other._id,
                country: "germany",
                name: "German",
            });

            const response = await getLeaderboard(
                "?scope=country&country=INDIA",
            );

            expect(response.body.data.scope).toBe("country");
            expect(response.body.data.results.map((r) => r.name)).toEqual([
                "Indian",
            ]);
        });

        it("should return a 400 with status fail when country is missing", async () => {
            const response = await getLeaderboard("?scope=country");

            expect(response.statusCode).toBe(400);
            expect(response.body.status).toBe("fail");
            expect(response.body.message).toBe(
                "country is required for scope=country",
            );
        });
    });

    describe("scope=age", () => {
        it("should filter by ageGroup", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await addRow({ ageGroup: "25-34", name: "Younger" });
            await addRow({
                userId: other._id,
                ageGroup: "35-44",
                name: "Older",
            });

            const response = await getLeaderboard("?scope=age&ageGroup=25-34");

            expect(response.body.data.scope).toBe("age");
            expect(response.body.data.results.map((r) => r.name)).toEqual([
                "Younger",
            ]);
        });

        it("should return a 400 with status fail when ageGroup is missing", async () => {
            const response = await getLeaderboard("?scope=age");

            expect(response.statusCode).toBe(400);
            expect(response.body.status).toBe("fail");
            expect(response.body.message).toBe(
                "ageGroup is required for scope=age",
            );
        });
    });

    describe("scope handling", () => {
        it("should accept the scope in any case", async () => {
            const response = await getLeaderboard("?scope=GLOBAL");

            expect(response.body.data.scope).toBe("global");
        });

        it("should treat an unknown scope as global", async () => {
            const response = await getLeaderboard("?scope=planet");

            expect(response.body.data.scope).toBe("planet");
            expect(response.statusCode).toBe(200);
        });
    });

    describe("authentication", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app).get("/leaderboard");

            expect(response.statusCode).toBe(401);
        });
    });
});
