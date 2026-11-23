const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const Plan = require("../../src/modules/plan/planModel");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const User = require("../../src/modules/user/userModel");
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

const seedPlan = async () => {
    const price = await PriceCatalog.create({
        stripePriceId: "price_monthly",
        stripeProductId: "prod_plan",
        type: "recurring",
        currency: "EUR",
        unitAmount: 1999,
        productDuration: "monthly",
    });

    return await Plan.create({
        name: "Pro",
        stripeProductId: "prod_plan",
        prices: { monthly: { priceId: price._id, intervalCount: 1 } },
    });
};

describe("POST /stripe/subscription/confirm", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser({
            stripeCustomerId: "cus_saved",
            defaultPaymentMethodId: "pm_saved",
        });
        token = getAccessToken(user._id);
        mockStripe.subscriptions.create.mockResolvedValue({
            id: "sub_confirmed",
            status: "active",
        });
    });

    const confirm = (body, accessToken = token) =>
        request(app)
            .post("/stripe/subscription/confirm")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app)
                .post("/stripe/subscription/confirm")
                .send({});

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given an invalid body", () => {
        it("should return a 400 status code when paymentIntentId is missing", async () => {
            const response = await confirm({ planId: "x", type: "monthly" });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("paymentIntentId is required");
        });

        it("should return a 400 status code when planId is missing", async () => {
            const response = await confirm({
                paymentIntentId: "pi_1",
                type: "monthly",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("planId is required");
        });

        it("should return a 400 status code when type is missing", async () => {
            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: "x",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("type is required");
        });
    });

    describe("given the plan does not exist", () => {
        it("should return a 404 status code", async () => {
            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: new mongoose.Types.ObjectId().toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe("Plan not found");
        });
    });

    describe("given the payment intent is not usable", () => {
        it("should return a 400 status code when it still requires action", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "requires_action",
            });

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.status).toBe("error");
            expect(response.body.message).toBe(
                "PaymentIntent still requires action",
            );
            expect(response.body.data).toEqual({
                paymentIntentId: "pi_1",
                status: "requires_action",
            });
        });

        it("should return a 400 status code when it has not succeeded", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "processing",
            });

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "PaymentIntent must be succeeded to create subscription",
            );
        });
    });

    describe("given the payment intent succeeded", () => {
        it("should return the one-click subscription the payment belongs to", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                metadata: { subscriptionId: "sub_one_click" },
            });
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_one_click",
                status: "active",
            });

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.data.subscriptionId).toBe("sub_one_click");
            expect(response.body.data.status).toBe("active");
            expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                "sub_one_click",
            );
            expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
        });

        it("should return a 409 status code when the payment has no subscription", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                metadata: { flow_id: "ORIGINAL_FLOW" },
            });

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(409);
            expect(response.body.message).toBe(
                "This payment does not belong to a subscription",
            );
            expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
        });
    });

    describe("given Stripe fails", () => {
        it("should propagate the Stripe status code", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                metadata: { subscriptionId: "sub_one_click" },
            });
            const stripeError = new Error("rate_limited");
            stripeError.statusCode = 429;
            mockStripe.subscriptions.retrieve.mockRejectedValue(stripeError);

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(429);
            expect(response.body.message).toBe("rate_limited");
        });

        it("should return a 500 status code when the retrieve fails", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockRejectedValue(
                new Error("network down"),
            );

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(500);
        });
    });
});
