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
        it("should create a regular subscription", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                metadata: {},
            });

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Subscription created after 3D Secure authentication",
            );
            expect(response.body.data.subscriptionId).toBe("sub_confirmed");
            expect(response.body.data.plan).toEqual({
                id: plan._id.toString(),
                name: "Pro",
                type: "monthly",
                recurringCadence: "monthly",
                paidTrial: false,
                freeTrialDays: 0,
                trialRequested: false,
                trialHonored: false,
            });
            expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    customer: "cus_saved",
                    items: [{ price: "price_monthly", quantity: 1 }],
                    default_payment_method: "pm_saved",
                    proration_behavior: "none",
                }),
            );
        });

        it("should create a trial subscription from the intent metadata", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                metadata: {
                    recurringCadence: "monthly",
                    trialRequested: "true",
                    trialHonored: "true",
                    freeTrialDays: "3",
                    trialPriceId: "price_trial",
                },
            });

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "trial",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Subscription created with trial after 3D Secure authentication",
            );
            expect(response.body.data.plan.paidTrial).toBe(true);
            expect(response.body.data.plan.freeTrialDays).toBe(3);
            expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                expect.objectContaining({ trial_period_days: 3 }),
            );
        });

        it("should return a 400 status code when the requested cadence is missing", async () => {
            const plan = await Plan.create({
                name: "Pro",
                stripeProductId: "prod_plan",
                prices: {},
            });
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                metadata: {},
            });

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "yearly",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Plan does not have a yearly price configured",
            );
        });
    });

    describe("given Stripe rejects the subscription", () => {
        it("should return a 404 status code for a missing price", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                metadata: {},
            });
            const stripeError = new Error("No such price");
            stripeError.type = "StripeInvalidRequestError";
            stripeError.code = "resource_missing";
            stripeError.raw = {
                param: "price",
                message: "No such price: 'price_monthly'",
            };
            mockStripe.subscriptions.create.mockRejectedValue(stripeError);

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe(
                "Stripe price not found: price_monthly. The price may have been deleted in Stripe. Please verify the price exists in your Stripe account.",
            );
        });

        it("should propagate the Stripe status code", async () => {
            const plan = await seedPlan();
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                metadata: {},
            });
            const stripeError = new Error("card_declined");
            stripeError.statusCode = 402;
            mockStripe.subscriptions.create.mockRejectedValue(stripeError);

            const response = await confirm({
                paymentIntentId: "pi_1",
                planId: plan._id.toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(402);
            expect(response.body.message).toBe("card_declined");
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
