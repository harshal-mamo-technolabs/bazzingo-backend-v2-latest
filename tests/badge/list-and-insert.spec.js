const request = require("supertest");
const app = require("../../src/app");
const Badge = require("../../src/modules/badge/badgeModel");
const { badges } = require("../../src/modules/badge/badgeData");
const { useInMemoryDatabase } = require("../utils/db");
const {
    createAdmin,
    createUser,
    getAdminToken,
    getAccessToken,
} = require("../utils/fixtures");

const makeBadge = (overrides = {}) => ({
    name: "logic-master",
    title: "Logic Master",
    description: "Scored 90%+ in Logic games 3 times",
    category: "game-achievement",
    imageUrl: "🧠",
    rarity: "rare",
    criteria: { requiredCount: 3 },
    ...overrides,
});

describe("GET /badges", () => {
    useInMemoryDatabase();

    const getBadges = () => request(app).get("/badges");

    it("should return a 200 status code without a token", async () => {
        const response = await getBadges();

        expect(response.statusCode).toBe(200);
    });

    it("should return the success envelope", async () => {
        const response = await getBadges();

        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("All badges retrieved successfully");
    });

    it("should return the active badges", async () => {
        await Badge.create(makeBadge());

        const response = await getBadges();

        expect(response.body.data.badges).toHaveLength(1);
        expect(response.body.data.badges[0].name).toBe("logic-master");
    });

    it("should hide inactive badges", async () => {
        await Badge.create(makeBadge({ isActive: false }));

        const response = await getBadges();

        expect(response.body.data.badges).toHaveLength(0);
    });

    it("should sort by category, then rarity, then name", async () => {
        await Badge.create(
            makeBadge({
                name: "zeta",
                category: "engagement",
                rarity: "common",
            }),
        );
        await Badge.create(
            makeBadge({
                name: "alpha",
                category: "engagement",
                rarity: "common",
            }),
        );
        await Badge.create(
            makeBadge({
                name: "beta",
                category: "assessment-achievement",
                rarity: "common",
            }),
        );

        const response = await getBadges();

        expect(response.body.data.badges.map((b) => b.name)).toEqual([
            "beta",
            "alpha",
            "zeta",
        ]);
    });

    it("should return an empty list when nothing is seeded", async () => {
        const response = await getBadges();

        expect(response.body.data.badges).toEqual([]);
    });
});

describe("POST /badges/bulk-insert", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        const admin = await createAdmin();
        adminToken = getAdminToken(admin._id);
    });

    const bulkInsert = (token = adminToken) =>
        request(app)
            .post("/badges/bulk-insert")
            .set("Authorization", `Bearer ${token}`);

    describe("given an admin token", () => {
        it("should return a 201 status code", async () => {
            const response = await bulkInsert();

            expect(response.statusCode).toBe(201);
        });

        it("should return the success envelope", async () => {
            const response = await bulkInsert();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe(
                "Badges bulk inserted successfully",
            );
        });

        it("should insert every badge from the catalogue", async () => {
            const response = await bulkInsert();

            expect(response.body.data.totalBadges).toBe(badges.length);
            expect(await Badge.countDocuments()).toBe(badges.length);
        });

        it("should return only the summary fields for each badge", async () => {
            const response = await bulkInsert();

            expect(Object.keys(response.body.data.badges[0]).sort()).toEqual([
                "category",
                "name",
                "rarity",
                "title",
            ]);
        });

        it("should replace the existing badges", async () => {
            await Badge.create(makeBadge({ name: "stale-badge" }));

            await bulkInsert();

            expect(await Badge.findOne({ name: "stale-badge" })).toBeNull();
            expect(await Badge.countDocuments()).toBe(badges.length);
        });

        it("should be idempotent when run twice", async () => {
            await bulkInsert();
            await bulkInsert();

            expect(await Badge.countDocuments()).toBe(badges.length);
        });

        it("should seed the two registration badges", async () => {
            await bulkInsert();

            expect(
                await Badge.findOne({ name: "leaderboard-rookie" }),
            ).not.toBeNull();
            expect(
                await Badge.findOne({ name: "early-adopter" }),
            ).not.toBeNull();
        });
    });

    describe("given a token that is not an admin token", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app).post("/badges/bulk-insert");

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 for a user token", async () => {
            const user = await createUser();

            const response = await bulkInsert(getAccessToken(user._id));

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 for an inactive admin", async () => {
            const admin = await createAdmin({
                email: "inactive@bazzingo.com",
                isActive: false,
            });

            const response = await bulkInsert(getAdminToken(admin._id));

            expect(response.statusCode).toBe(401);
            expect(response.body.message).toBe("Invalid or inactive admin");
        });

        it("should not insert anything when the caller is rejected", async () => {
            await request(app).post("/badges/bulk-insert");

            expect(await Badge.countDocuments()).toBe(0);
        });
    });
});
