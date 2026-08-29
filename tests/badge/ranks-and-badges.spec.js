const request = require("supertest");
const app = require("../../src/app");
const Badge = require("../../src/modules/badge/badgeModel");
const BadgeUnlock = require("../../src/modules/badge/badgeUnlockModel");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

describe("GET /badges/ranks-and-badges", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const makeBadge = (overrides = {}) =>
        Badge.create({
            name: "logic-master",
            title: "Logic Master",
            description: "Scored 90%+ in Logic games 3 times",
            category: "game-achievement",
            imageUrl: "🧠",
            rarity: "rare",
            criteria: {},
            ...overrides,
        });

    const addLeaderboardRow = (overrides = {}) =>
        Leaderboard.create({
            userId: user._id,
            country: "india",
            ageGroup: "25-34",
            gameGlobalRank: 3,
            assessmentGlobalRank: 4,
            gameCountryRank: 1,
            assessmentCountryRank: 2,
            gameAgeGroupRank: 5,
            assessmentAgeGroupRank: 6,
            ...overrides,
        });

    const getRanksAndBadges = (accessToken = token) =>
        request(app)
            .get("/badges/ranks-and-badges")
            .set("Authorization", `Bearer ${accessToken}`);

    describe("given an authenticated user", () => {
        it("should return a 200 status code", async () => {
            const response = await getRanksAndBadges();

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            const response = await getRanksAndBadges();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe(
                "User ranks and badges retrieved successfully",
            );
        });

        it("should return every rank from the leaderboard row", async () => {
            await addLeaderboardRow();

            const response = await getRanksAndBadges();

            expect(response.body.data.gameGlobalRank).toBe(3);
            expect(response.body.data.assessmentGlobalRank).toBe(4);
            expect(response.body.data.gameCountryRank).toBe(1);
            expect(response.body.data.assessmentCountryRank).toBe(2);
            expect(response.body.data.gameAgeGroupRank).toBe(5);
            expect(response.body.data.assessmentAgeGroupRank).toBe(6);
            expect(response.body.data.country).toBe("india");
        });

        it("should return null ranks when the user has no leaderboard row", async () => {
            const response = await getRanksAndBadges();

            expect(response.body.data.gameGlobalRank).toBeNull();
            expect(response.body.data.assessmentGlobalRank).toBeNull();
            expect(response.body.data.country).toBeNull();
        });

        it("should group the badges by category", async () => {
            await makeBadge({ name: "logic-master", category: "engagement" });
            await makeBadge({
                name: "smart-start",
                category: "assessment-achievement",
            });

            const response = await getRanksAndBadges();

            expect(Object.keys(response.body.data.badge).sort()).toEqual([
                "assessment-achievement",
                "engagement",
            ]);
        });

        it("should return the presentation fields for each badge", async () => {
            await makeBadge();

            const response = await getRanksAndBadges();

            const badge = response.body.data.badge["game-achievement"][0];
            expect(Object.keys(badge).sort()).toEqual([
                "description",
                "imageUrl",
                "isUnlocked",
                "name",
                "title",
            ]);
        });

        it("should mark an unlocked badge as unlocked", async () => {
            const badge = await makeBadge();
            await BadgeUnlock.create({ userId: user._id, badgeId: badge._id });

            const response = await getRanksAndBadges();

            expect(
                response.body.data.badge["game-achievement"][0].isUnlocked,
            ).toBe(true);
        });

        it("should mark a badge the user has not earned as locked", async () => {
            await makeBadge();

            const response = await getRanksAndBadges();

            expect(
                response.body.data.badge["game-achievement"][0].isUnlocked,
            ).toBe(false);
        });

        it("should not count another user's unlock", async () => {
            const badge = await makeBadge();
            const other = await createUser({ email: "other@bazzingo.com" });
            await BadgeUnlock.create({ userId: other._id, badgeId: badge._id });

            const response = await getRanksAndBadges();

            expect(
                response.body.data.badge["game-achievement"][0].isUnlocked,
            ).toBe(false);
        });

        it("should hide inactive badges", async () => {
            await makeBadge({ isActive: false });

            const response = await getRanksAndBadges();

            expect(response.body.data.badge).toEqual({});
        });

        it("should return an empty badge map when nothing is seeded", async () => {
            const response = await getRanksAndBadges();

            expect(response.body.data.badge).toEqual({});
        });
    });

    describe("authentication", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app).get("/badges/ranks-and-badges");

            expect(response.statusCode).toBe(401);
        });
    });
});
