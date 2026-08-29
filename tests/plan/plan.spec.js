const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const Plan = require("../../src/modules/plan/planModel");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const { useInMemoryDatabase } = require("../utils/db");
const {
    createAdmin,
    createUser,
    getAdminToken,
    getAccessToken,
} = require("../utils/fixtures");

const mockStripe = {
    products: { create: jest.fn(), update: jest.fn() },
};

jest.mock("../../src/config/stripe", () => ({
    getStripe: () => mockStripe,
}));

const planRouter = require("../../src/modules/plan/planRouter");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/plans", planRouter);
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const createPrice = (overrides = {}) =>
    PriceCatalog.create({
        stripePriceId: `price_${Math.random().toString(36).slice(2)}`,
        stripeProductId: "prod_seed",
        type: "recurring",
        lookupKey: `lookup_${Math.random().toString(36).slice(2)}`,
        currency: "EUR",
        unitAmount: 1999,
        productDuration: "monthly",
        ...overrides,
    });

const seedPlan = (overrides = {}) =>
    Plan.create({
        name: "Pro",
        description: "Pro plan",
        stripeProductId: "prod_seed",
        prices: {
            monthly: { intervalCount: 1 },
            yearly: { intervalCount: 1 },
        },
        ...overrides,
    });

describe("POST /plans", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        jest.clearAllMocks();
        mockStripe.products.create.mockResolvedValue({ id: "prod_123" });
        adminToken = getAdminToken((await createAdmin())._id);
    });

    const create = (body, token = adminToken) =>
        request(app)
            .post("/plans")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    describe("given a valid body", () => {
        it("should return a 201 with the v1 envelope", async () => {
            const response = await create({ name: "Pro" });

            expect(response.statusCode).toBe(201);
            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Plan created successfully");
            expect(response.body.data.stripeProductId).toBe("prod_123");
            expect(response.body.data.plan.name).toBe("Pro");
        });

        it("should persist the plan with the stripe product id", async () => {
            await create({ name: "Pro", description: "Best plan" });

            const plan = await Plan.findOne({});
            expect(plan.stripeProductId).toBe("prod_123");
            expect(plan.description).toBe("Best plan");
            expect(plan.active).toBe(true);
            expect(plan.prices.monthly.intervalCount).toBe(1);
            expect(plan.prices.yearly.intervalCount).toBe(1);
        });

        it("should send an undefined description to stripe when empty", async () => {
            await create({ name: "Pro" });

            expect(mockStripe.products.create).toHaveBeenCalledWith({
                name: "Pro",
                description: undefined,
                metadata: { type: "subscription_plan" },
            });
        });

        it("should merge the body metadata into the stripe metadata", async () => {
            await create({
                name: "Pro",
                description: "Best plan",
                metadata: { tier: "gold" },
            });

            expect(mockStripe.products.create).toHaveBeenCalledWith({
                name: "Pro",
                description: "Best plan",
                metadata: { type: "subscription_plan", tier: "gold" },
            });
        });
    });

    describe("given an invalid body", () => {
        it("should return a 400 when name is missing", async () => {
            const response = await create({});

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("name is required");
            expect(mockStripe.products.create).not.toHaveBeenCalled();
        });

        it("should return a 400 when name is only whitespace", async () => {
            const response = await create({ name: "   " });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("name is required");
        });
    });

    describe("given stripe fails", () => {
        it("should reuse the stripe status code and message", async () => {
            mockStripe.products.create.mockRejectedValue(
                Object.assign(new Error("Invalid product"), {
                    statusCode: 400,
                }),
            );

            const response = await create({ name: "Pro" });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Invalid product");
            expect(await Plan.countDocuments()).toBe(0);
        });

        it("should fall back to a 500 for an error without a status code", async () => {
            mockStripe.products.create.mockRejectedValue(
                new Error("socket hang up"),
            );

            const response = await create({ name: "Pro" });

            expect(response.statusCode).toBe(500);
            expect(await Plan.countDocuments()).toBe(0);
        });

        it("should deactivate the stripe product carried on the error", async () => {
            mockStripe.products.create.mockRejectedValue(
                Object.assign(new Error("boom"), {
                    statusCode: 400,
                    stripeProductId: "prod_rollback",
                }),
            );

            await create({ name: "Pro" });

            expect(mockStripe.products.update).toHaveBeenCalledWith(
                "prod_rollback",
                { active: false },
            );
        });
    });

    describe("authorisation", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post("/plans")
                .send({ name: "Pro" });

            expect(response.statusCode).toBe(401);
            expect(response.body.message).toBe("Admin authentication required");
        });

        it("should return a 401 for a user token", async () => {
            const user = await createUser();

            const response = await create(
                { name: "Pro" },
                getAccessToken(user._id),
            );

            expect(response.statusCode).toBe(401);
        });
    });
});

describe("GET /plans", () => {
    useInMemoryDatabase();

    const list = () => request(app).get("/plans");

    it("should return a 200 with the v1 envelope for anonymous callers", async () => {
        const response = await list();

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Plans retrieved successfully");
        expect(response.body.data.plans).toEqual([]);
    });

    it("should convert the populated unit amounts to major units", async () => {
        const monthly = await createPrice({ unitAmount: 1999 });
        const yearly = await createPrice({
            unitAmount: 19900,
            productDuration: "yearly",
        });
        const trial = await createPrice({ unitAmount: 100 });

        await seedPlan({
            prices: {
                monthly: { priceId: monthly._id, intervalCount: 1 },
                yearly: { priceId: yearly._id, intervalCount: 12 },
                trial: trial._id,
            },
        });

        const { prices } = (await list()).body.data.plans[0];

        expect(prices.monthly.priceId.unitAmount).toBe(19.99);
        expect(prices.monthly.intervalCount).toBe(1);
        expect(prices.yearly.priceId.unitAmount).toBe(199);
        expect(prices.yearly.intervalCount).toBe(12);
        expect(prices.trial.unitAmount).toBe(1);
    });

    it("should only select the whitelisted price fields", async () => {
        const monthly = await createPrice();

        await seedPlan({
            prices: { monthly: { priceId: monthly._id, intervalCount: 1 } },
        });

        const { priceId } = (await list()).body.data.plans[0].prices.monthly;

        expect(priceId.stripePriceId).toBe(monthly.stripePriceId);
        expect(priceId.currency).toBe("EUR");
        expect(priceId.productDuration).toBe("monthly");
        expect(priceId.lookupKey).toBeUndefined();
    });

    it("should return null prices when nothing is attached", async () => {
        await seedPlan();

        const { prices } = (await list()).body.data.plans[0];

        expect(prices.monthly.priceId).toBeNull();
        expect(prices.yearly.priceId).toBeNull();
        expect(prices.trial).toBeNull();
    });

    it("should sort the newest plan first", async () => {
        await seedPlan({
            name: "Older",
            createdAt: new Date("2020-01-01"),
        });
        await seedPlan({
            name: "Newer",
            createdAt: new Date("2026-01-01"),
        });

        const { plans } = (await list()).body.data;

        expect(plans.map((plan) => plan.name)).toEqual(["Newer", "Older"]);
    });
});

describe("POST /plans/attach-prices", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        adminToken = getAdminToken((await createAdmin())._id);
    });

    const attach = (body, token = adminToken) =>
        request(app)
            .post("/plans/attach-prices")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    it("should attach every price and return the populated plan", async () => {
        const plan = await seedPlan();
        const monthly = await createPrice();
        const yearly = await createPrice();
        const trial = await createPrice();

        const response = await attach({
            planId: String(plan._id),
            monthlyPriceId: String(monthly._id),
            monthlyIntervalCount: 3,
            yearlyPriceId: String(yearly._id),
            yearlyIntervalCount: 12,
            trialPriceId: String(trial._id),
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Plan prices updated successfully");
        expect(response.body.data.plan.prices.monthly.priceId.unitAmount).toBe(
            1999,
        );
        expect(response.body.data.plan.prices.monthly.intervalCount).toBe(3);
        expect(response.body.data.plan.prices.yearly.intervalCount).toBe(12);
        expect(response.body.data.plan.prices.trial.stripePriceId).toBe(
            trial.stripePriceId,
        );
    });

    it("should default the interval counts to one", async () => {
        const plan = await seedPlan();
        const monthly = await createPrice();

        const response = await attach({
            planId: String(plan._id),
            monthlyPriceId: String(monthly._id),
        });

        expect(response.body.data.plan.prices.monthly.intervalCount).toBe(1);
    });

    it("should leave untouched prices alone", async () => {
        const monthly = await createPrice();
        const plan = await seedPlan({
            prices: { monthly: { priceId: monthly._id, intervalCount: 2 } },
        });
        const yearly = await createPrice();

        await attach({
            planId: String(plan._id),
            yearlyPriceId: String(yearly._id),
        });

        const saved = await Plan.findById(plan._id);
        expect(String(saved.prices.monthly.priceId)).toBe(String(monthly._id));
        expect(saved.prices.monthly.intervalCount).toBe(2);
    });

    it("should return a 400 when planId is missing", async () => {
        const response = await attach({});

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("planId is required");
    });

    it("should return a 404 for an unknown plan", async () => {
        const response = await attach({
            planId: String(new mongoose.Types.ObjectId()),
        });

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Plan not found");
    });

    describe("authorisation", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post("/plans/attach-prices")
                .send({});

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 for a user token", async () => {
            const user = await createUser();

            const response = await attach({}, getAccessToken(user._id));

            expect(response.statusCode).toBe(401);
        });
    });
});

describe("POST /plans/create-direct-plan", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        adminToken = getAdminToken((await createAdmin())._id);
    });

    const createDirect = (body, token = adminToken) =>
        request(app)
            .post("/plans/create-direct-plan")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    it("should return a 201 with the populated plan", async () => {
        const monthly = await createPrice();

        const response = await createDirect({
            name: "Direct",
            description: "Direct plan",
            stripeProductId: "prod_direct",
            prices: {
                monthly: { priceId: String(monthly._id), intervalCount: 3 },
                trial: String(monthly._id),
            },
        });

        expect(response.statusCode).toBe(201);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Plan created");
        expect(response.body.data.plan.name).toBe("Direct");
        expect(response.body.data.plan.stripeProductId).toBe("prod_direct");
        expect(response.body.data.plan.prices.monthly.intervalCount).toBe(3);
        expect(response.body.data.plan.prices.monthly.priceId.unitAmount).toBe(
            1999,
        );
        expect(response.body.data.plan.prices.trial.unitAmount).toBe(1999);
    });

    it("should honour active false", async () => {
        const response = await createDirect({
            name: "Direct",
            stripeProductId: "prod_direct",
            active: false,
        });

        expect(response.body.data.plan.active).toBe(false);
    });

    it("should fall back to one for a non numeric interval count", async () => {
        const monthly = await createPrice();

        const response = await createDirect({
            name: "Direct",
            stripeProductId: "prod_direct",
            prices: {
                monthly: { priceId: String(monthly._id), intervalCount: "3" },
            },
        });

        expect(response.body.data.plan.prices.monthly.intervalCount).toBe(1);
    });

    it("should clamp a non positive interval count to one", async () => {
        const monthly = await createPrice();

        const response = await createDirect({
            name: "Direct",
            stripeProductId: "prod_direct",
            prices: {
                monthly: { priceId: String(monthly._id), intervalCount: 0 },
            },
        });

        expect(response.body.data.plan.prices.monthly.intervalCount).toBe(1);
    });

    it("should return a 400 when name is missing", async () => {
        const response = await createDirect({
            stripeProductId: "prod_direct",
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("name is required");
    });

    it("should return a 400 when stripeProductId is missing", async () => {
        const response = await createDirect({ name: "Direct" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("stripeProductId is required");
    });

    describe("authorisation", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post("/plans/create-direct-plan")
                .send({ name: "Direct", stripeProductId: "prod_direct" });

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 for a user token", async () => {
            const user = await createUser();

            const response = await createDirect(
                { name: "Direct", stripeProductId: "prod_direct" },
                getAccessToken(user._id),
            );

            expect(response.statusCode).toBe(401);
        });
    });
});

describe("POST /plans/:planId/attach-price", () => {
    useInMemoryDatabase();

    let adminToken;
    let plan;
    let price;

    beforeEach(async () => {
        adminToken = getAdminToken((await createAdmin())._id);
        plan = await seedPlan();
        price = await createPrice();
    });

    const attach = (body, planId = String(plan._id), token = adminToken) =>
        request(app)
            .post(`/plans/${planId}/attach-price`)
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    it("should attach a monthly price", async () => {
        const response = await attach({
            priceType: "monthly",
            priceId: String(price._id),
            intervalCount: 3,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe(
            "Price attached to plan successfully",
        );
        expect(response.body.data.plan.prices.monthly.intervalCount).toBe(3);
        expect(response.body.data.attachedPrice).toEqual({
            type: "monthly",
            priceId: String(price._id),
            intervalCount: 3,
        });
    });

    it("should default the interval count to one", async () => {
        const response = await attach({
            priceType: "yearly",
            priceId: String(price._id),
        });

        expect(response.body.data.plan.prices.yearly.intervalCount).toBe(1);
        expect(response.body.data.attachedPrice.intervalCount).toBe(1);
    });

    it("should attach a trial price without an interval count", async () => {
        const response = await attach({
            priceType: "trial",
            priceId: String(price._id),
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.data.plan.prices.trial.stripePriceId).toBe(
            price.stripePriceId,
        );
        expect(response.body.data.attachedPrice).toEqual({
            type: "trial",
            priceId: String(price._id),
        });
    });

    it("should return a 400 when priceType is missing", async () => {
        const response = await attach({ priceId: String(price._id) });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("priceType is required");
    });

    it("should return a 400 when priceId is missing", async () => {
        const response = await attach({ priceType: "monthly" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("priceId is required");
    });

    it("should return a 400 for an unsupported priceType", async () => {
        const response = await attach({
            priceType: "weekly",
            priceId: String(price._id),
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "priceType must be one of: monthly, yearly, trial",
        );
    });

    it("should return a 400 for a non numeric interval count", async () => {
        const response = await attach({
            priceType: "monthly",
            priceId: String(price._id),
            intervalCount: "3",
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "intervalCount must be a positive integer",
        );
    });

    it("should return a 400 for a zero interval count", async () => {
        const response = await attach({
            priceType: "monthly",
            priceId: String(price._id),
            intervalCount: 0,
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "intervalCount must be a positive integer",
        );
    });

    it("should ignore the interval count for a trial price", async () => {
        const response = await attach({
            priceType: "trial",
            priceId: String(price._id),
            intervalCount: "nonsense",
        });

        expect(response.statusCode).toBe(200);
    });

    it("should return a 404 for an unknown plan", async () => {
        const response = await attach(
            { priceType: "monthly", priceId: String(price._id) },
            String(new mongoose.Types.ObjectId()),
        );

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Plan not found");
    });

    it("should return a 404 for a price outside the catalog", async () => {
        const response = await attach({
            priceType: "monthly",
            priceId: String(new mongoose.Types.ObjectId()),
        });

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Price not found in catalog");
    });

    describe("authorisation", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post(`/plans/${plan._id}/attach-price`)
                .send({ priceType: "monthly", priceId: String(price._id) });

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 for a user token", async () => {
            const user = await createUser();

            const response = await attach(
                { priceType: "monthly", priceId: String(price._id) },
                String(plan._id),
                getAccessToken(user._id),
            );

            expect(response.statusCode).toBe(401);
        });
    });
});
