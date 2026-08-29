const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const Plan = require("../../src/modules/plan/planModel");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const Order = require("../../src/modules/stripe/orderModel");
const Subscription = require("../../src/modules/stripe/subscriptionModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

const mockStripe = {
    prices: { create: jest.fn(), retrieve: jest.fn() },
    customers: { create: jest.fn(), update: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    checkout: { sessions: { create: jest.fn(), list: jest.fn() } },
    subscriptions: {
        create: jest.fn(),
        retrieve: jest.fn(),
        update: jest.fn(),
        cancel: jest.fn(),
        list: jest.fn(),
    },
    invoices: { retrieve: jest.fn(), list: jest.fn(), pay: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
};

jest.mock("../../src/config/stripe", () => ({
    getStripe: () => mockStripe,
}));

const stripeRouter = require("../../src/modules/stripe/stripeRouter");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/stripe", stripeRouter);
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const seedSubscription = (userId, overrides = {}) =>
    Subscription.create({
        userId,
        stripeSubscriptionId: `sub_${Math.random().toString(36).slice(2)}`,
        status: "active",
        planDuration: "monthly",
        currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
        ...overrides,
    });

describe("GET /stripe/subscription/status", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const getStatus = (accessToken = token) =>
        request(app)
            .get("/stripe/subscription/status")
            .set("Authorization", `Bearer ${accessToken}`);

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app).get(
                "/stripe/subscription/status",
            );

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given the user has no subscription", () => {
        it("should return a 200 status code with hasSubscription false", async () => {
            const response = await getStatus();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe("No subscription found");
            expect(response.body.data).toEqual({ hasSubscription: false });
        });
    });

    describe("given the subscription is not active", () => {
        it("should return a 200 status code with hasSubscription false", async () => {
            await seedSubscription(user._id, { status: "canceled" });

            const response = await getStatus();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe("No subscription found");
            expect(response.body.data).toEqual({ hasSubscription: false });
        });
    });

    describe("given the subscription is active", () => {
        it("should return a 200 status code with the subscription and plan", async () => {
            const plan = await Plan.create({
                name: "Pro",
                stripeProductId: "prod_plan",
            });
            await seedSubscription(user._id, {
                planId: plan._id.toString(),
                cancelAtPeriodEnd: true,
                trialStart: new Date("2026-01-01T00:00:00.000Z"),
                trialEnd: new Date("2026-01-04T00:00:00.000Z"),
            });

            const response = await getStatus();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe("Subscription found");
            expect(response.body.data.hasSubscription).toBe(true);
            expect(response.body.data.subscription.status).toBe("active");
            expect(response.body.data.subscription.plan.name).toBe("Pro");
            expect(response.body.data.subscription.cancelAtPeriodEnd).toBe(
                true,
            );
            expect(response.body.data.subscription.trialEnd).toBe(
                "2026-01-04T00:00:00.000Z",
            );
        });

        it("should return a null plan when the subscription has no plan", async () => {
            await seedSubscription(user._id, { status: "trialing" });

            const response = await getStatus();

            expect(response.body.data.subscription.plan).toBeNull();
        });
    });
});

describe("GET /stripe/session/check", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const check = (query, accessToken = token) =>
        request(app)
            .get(`/stripe/session/check${query}`)
            .set("Authorization", `Bearer ${accessToken}`);

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app).get("/stripe/session/check");

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given no stripeSessionId", () => {
        it("should return a 400 status code", async () => {
            const response = await check("");

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("stripeSessionId is required");
        });
    });

    describe("given the session is unknown", () => {
        it("should return a 200 status code reporting no presence", async () => {
            const response = await check("?stripeSessionId=cs_missing");

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe("Presence check completed");
            expect(response.body.data).toEqual({
                sessionId: "cs_missing",
                presentInOrder: false,
                presentInSubscription: false,
                orderId: null,
                subscriptionId: null,
            });
        });
    });

    describe("given the session exists", () => {
        it("should report the matching order and subscription", async () => {
            const order = await Order.create({
                userId: user._id,
                stripeSessionId: "cs_known",
                status: "succeeded",
            });
            const subscription = await seedSubscription(user._id, {
                stripeSessionId: "cs_known",
            });

            const response = await check("?stripeSessionId=cs_known");

            expect(response.body.data.presentInOrder).toBe(true);
            expect(response.body.data.presentInSubscription).toBe(true);
            expect(response.body.data.orderId).toBe(order._id.toString());
            expect(response.body.data.subscriptionId).toBe(
                subscription._id.toString(),
            );
        });
    });
});

describe("GET /stripe/user/subscription-status", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const getStatus = (accessToken = token) =>
        request(app)
            .get("/stripe/user/subscription-status")
            .set("Authorization", `Bearer ${accessToken}`);

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app).get(
                "/stripe/user/subscription-status",
            );

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given the user has no active subscription", () => {
        it("should return a 200 status code with the none status", async () => {
            await seedSubscription(user._id, { status: "canceled" });

            const response = await getStatus();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "User has no active subscription",
            );
            expect(response.body.data).toEqual({
                subscriptionStatus: "none",
                planName: null,
                subscription: null,
            });
        });
    });

    describe("given the user has an active subscription", () => {
        it("should return a 200 status code with the plan name", async () => {
            const plan = await Plan.create({
                name: "Pro",
                stripeProductId: "prod_plan",
            });
            const price = await PriceCatalog.create({
                planId: plan._id,
                stripePriceId: "price_monthly",
                stripeProductId: "prod_plan",
                type: "recurring",
                currency: "EUR",
                unitAmount: 1999,
                productDuration: "monthly",
            });
            await seedSubscription(user._id, {
                status: "trialing",
                planId: plan._id.toString(),
                priceCatalogId: price._id,
                cancelAtPeriodEnd: false,
            });

            const response = await getStatus();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe("User has active subscription");
            expect(response.body.data.subscriptionStatus).toBe("trialing");
            expect(response.body.data.planName).toBe("Pro");
            expect(response.body.data.subscription).toEqual({
                planId: plan._id.toString(),
                planDuration: "monthly",
                status: "trialing",
                cancelAtPeriodEnd: false,
                cancelAt: null,
            });
        });

        it("should return a null plan name when the price is not linked", async () => {
            await seedSubscription(user._id);

            const response = await getStatus();

            expect(response.body.data.planName).toBeNull();
            expect(response.body.data.subscriptionStatus).toBe("active");
        });
    });
});

describe("GET /stripe/assessment-id", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const getAssessmentId = (query, accessToken = token) =>
        request(app)
            .get(`/stripe/assessment-id${query}`)
            .set("Authorization", `Bearer ${accessToken}`);

    const seedOrder = async (overrides = {}) => {
        const assessment = await FullAssessment.create({
            mainCategory: "iq-test",
            questions: 20,
            subcategories: ["logic"],
            stripeProductId: "prod_assessment",
        });

        return await Order.create({
            userId: user._id,
            assessmentId: assessment._id,
            status: "succeeded",
            ...overrides,
        });
    };

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app).get("/stripe/assessment-id");

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given neither identifier", () => {
        it("should return a 400 status code", async () => {
            const response = await getAssessmentId("");

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Either sessionId or orderId is required",
            );
        });
    });

    describe("given both identifiers", () => {
        it("should return a 400 status code", async () => {
            const response = await getAssessmentId(
                "?sessionId=cs_1&orderId=abc",
            );

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Please provide only one of sessionId or orderId, not both",
            );
        });
    });

    describe("given the order is unknown", () => {
        it("should return a 404 status code with the v1 body", async () => {
            const response = await getAssessmentId("?sessionId=cs_missing");

            expect(response.statusCode).toBe(404);
            expect(response.body.status).toBe("error");
            expect(response.body.message).toBe(
                "Order not found or assessment not linked to this order",
            );
            expect(response.body.data).toEqual({
                found: false,
                assessmentId: null,
            });
        });

        it("should return a 404 status code when the order has no assessment", async () => {
            const order = await Order.create({
                userId: user._id,
                status: "succeeded",
            });

            const response = await getAssessmentId(
                `?orderId=${order._id.toString()}`,
            );

            expect(response.statusCode).toBe(404);
            expect(response.body.data.found).toBe(false);
        });
    });

    describe("given a matching order", () => {
        it("should return the assessment id by session", async () => {
            const order = await seedOrder({ stripeSessionId: "cs_known" });

            const response = await getAssessmentId("?sessionId=cs_known");

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Assessment ID retrieved successfully",
            );
            expect(response.body.data).toEqual({
                found: true,
                assessmentId: order.assessmentId.toString(),
            });
        });

        it("should return the assessment id by order", async () => {
            const order = await seedOrder();

            const response = await getAssessmentId(
                `?orderId=${order._id.toString()}`,
            );

            expect(response.statusCode).toBe(200);
            expect(response.body.data.assessmentId).toBe(
                order.assessmentId.toString(),
            );
        });
    });

    describe("given a malformed order id", () => {
        it("should return a 500 status code", async () => {
            const response = await getAssessmentId("?orderId=not-an-id");

            expect(response.statusCode).toBe(500);
        });
    });
});
