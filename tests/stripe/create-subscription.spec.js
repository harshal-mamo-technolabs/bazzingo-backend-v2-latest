const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const logger = require("../../src/config/logger");
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
const { StripeService } = require("../../src/modules/stripe/stripeService");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/stripe", stripeRouter);
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const seedPriceCatalog = (overrides = {}) =>
    PriceCatalog.create({
        stripePriceId: `price_${Math.random().toString(36).slice(2)}`,
        stripeProductId: "prod_plan",
        type: "recurring",
        currency: "EUR",
        unitAmount: 1999,
        productDuration: "monthly",
        ...overrides,
    });

const seedPlanWithPrices = async ({ monthly, yearly, trial } = {}) => {
    const prices = {};

    if (monthly !== false) {
        prices.monthly = {
            priceId: (
                await seedPriceCatalog({ stripePriceId: "price_monthly" })
            )._id,
            intervalCount: 1,
        };
    }

    if (yearly) {
        prices.yearly = {
            priceId: (
                await seedPriceCatalog({
                    stripePriceId: "price_yearly",
                    productDuration: "yearly",
                })
            )._id,
            intervalCount: 1,
        };
    }

    if (trial) {
        prices.trial = (
            await seedPriceCatalog({
                stripePriceId: "price_trial",
                type: "one_time",
                productDuration: "onetime",
            })
        )._id;
    }

    return await Plan.create({
        name: "Pro",
        stripeProductId: "prod_plan",
        prices,
    });
};

describe("POST /stripe/subscription", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        token = getAccessToken(user._id);
        mockStripe.customers.create.mockResolvedValue({ id: "cus_new" });
        mockStripe.checkout.sessions.create.mockResolvedValue({
            id: "cs_sub_1",
            url: "https://checkout.stripe.com/cs_sub_1",
        });
        mockStripe.prices.retrieve.mockImplementation(async (id) =>
            id === "price_trial"
                ? {
                      id,
                      active: true,
                      type: "one_time",
                      currency: "eur",
                      unit_amount: 100,
                  }
                : {
                      id,
                      active: true,
                      type: "recurring",
                      currency: "eur",
                      unit_amount: 1999,
                  },
        );
    });

    const subscribe = (body, accessToken = token) =>
        request(app)
            .post("/stripe/subscription")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app)
                .post("/stripe/subscription")
                .send({});

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given an invalid body", () => {
        it("should return a 400 status code when planId is missing", async () => {
            const response = await subscribe({
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("planId is required");
        });

        it("should return a 400 status code when type is missing", async () => {
            const response = await subscribe({
                planId: new mongoose.Types.ObjectId().toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("type is required");
        });

        it("should return a 400 status code when the urls are missing", async () => {
            const response = await subscribe({
                planId: new mongoose.Types.ObjectId().toString(),
                type: "monthly",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "successUrl and cancelUrl are required",
            );
        });

        it("should return a 400 status code for an unsupported type", async () => {
            const response = await subscribe({
                planId: new mongoose.Types.ObjectId().toString(),
                type: "lifetime",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "type must be one of: trial, monthly, yearly",
            );
        });
    });

    describe("given the plan does not exist", () => {
        it("should return a 404 status code", async () => {
            const response = await subscribe({
                planId: new mongoose.Types.ObjectId().toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe("Plan not found");
        });
    });

    describe("given the plan has no usable price", () => {
        it("should return a 400 status code for a trial without recurring prices", async () => {
            const plan = await Plan.create({
                name: "Pro",
                stripeProductId: "prod_plan",
                prices: {},
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Plan must have either monthly or yearly price to create a subscription",
            );
        });

        it("should return a 400 status code when the requested cadence is missing", async () => {
            const plan = await seedPlanWithPrices();

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "yearly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Plan does not have a yearly price configured",
            );
        });

        it("should return a 400 status code when the price catalog row is gone", async () => {
            const missingId = new mongoose.Types.ObjectId();
            const plan = await Plan.create({
                name: "Pro",
                stripeProductId: "prod_plan",
                prices: { monthly: { priceId: missingId, intervalCount: 1 } },
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                `PriceCatalog not found for ref: ${missingId.toString()}`,
            );
        });

        it("should return a 400 status code when the catalog row has no Stripe price", async () => {
            const { insertedId } = await PriceCatalog.collection.insertOne({
                type: "recurring",
                currency: "EUR",
                unitAmount: 1999,
            });
            const plan = await Plan.create({
                name: "Pro",
                stripeProductId: "prod_plan",
                prices: { monthly: { priceId: insertedId, intervalCount: 1 } },
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                `PriceCatalog ${insertedId.toString()} is missing a valid Stripe price id (expected 'price_...')`,
            );
        });
    });

    describe("given Stripe reports an unusable price", () => {
        it("should return a 400 status code when the recurring price is inactive", async () => {
            const plan = await seedPlanWithPrices();
            mockStripe.prices.retrieve.mockResolvedValue({
                id: "price_monthly",
                active: false,
                type: "recurring",
                currency: "eur",
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Recurring price is inactive");
        });

        it("should return a 400 status code when the recurring price is one time", async () => {
            const plan = await seedPlanWithPrices();
            mockStripe.prices.retrieve.mockResolvedValue({
                id: "price_monthly",
                active: true,
                type: "one_time",
                currency: "eur",
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Recurring price must be a recurring price",
            );
        });

        it("should return a 400 status code when the trial price is inactive", async () => {
            const plan = await seedPlanWithPrices({ trial: true });
            mockStripe.prices.retrieve.mockImplementation(async (id) =>
                id === "price_trial"
                    ? {
                          id,
                          active: false,
                          type: "one_time",
                          currency: "eur",
                      }
                    : {
                          id,
                          active: true,
                          type: "recurring",
                          currency: "eur",
                      },
            );

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Trial price is inactive");
        });

        it("should return a 400 status code when the trial price is recurring", async () => {
            const plan = await seedPlanWithPrices({ trial: true });
            mockStripe.prices.retrieve.mockResolvedValue({
                active: true,
                type: "recurring",
                currency: "eur",
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Trial price must be a one-time price",
            );
        });

        it("should return a 400 status code when the currencies differ", async () => {
            const plan = await seedPlanWithPrices({ trial: true });
            mockStripe.prices.retrieve.mockImplementation(async (id) =>
                id === "price_trial"
                    ? {
                          id,
                          active: true,
                          type: "one_time",
                          currency: "usd",
                      }
                    : {
                          id,
                          active: true,
                          type: "recurring",
                          currency: "eur",
                      },
            );

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Currency mismatch between recurring and trial prices",
            );
        });
    });

    describe("given a user without a saved card", () => {
        it("should return a 200 status code with the checkout session", async () => {
            const plan = await seedPlanWithPrices();

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Subscription Checkout session created",
            );
            expect(response.body.data.sessionId).toBe("cs_sub_1");
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
        });

        it("should create the customer and pass it to the session", async () => {
            const plan = await seedPlanWithPrices();

            await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(mockStripe.customers.create).toHaveBeenCalledWith({
                email: user.email,
                name: user.name,
                metadata: {
                    userId: user._id.toString(),
                    source: "subscription_checkout_flow",
                },
            });
            expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    mode: "subscription",
                    customer: "cus_new",
                    payment_method_collection: "always",
                }),
            );

            const refreshed = await User.findById(user._id).lean();

            expect(refreshed.stripeCustomerId).toBe("cus_new");
        });

        it("carries real utm values but omits default ones", async () => {
            const plan = await seedPlanWithPrices();
            const lpUser = await createUser({
                email: "lp-lead@bazzingo.com",
                utmSource: "google",
                utmCampaign: "default",
                utmMedium: "default",
                utmEmail: "klaviyo",
            });
            const lpToken = getAccessToken(lpUser._id);

            await subscribe(
                {
                    planId: plan._id.toString(),
                    type: "monthly",
                    successUrl: "https://a",
                    cancelUrl: "https://b",
                },
                lpToken,
            );

            expect(mockStripe.customers.create).toHaveBeenCalledWith({
                email: lpUser.email,
                name: lpUser.name,
                metadata: {
                    userId: lpUser._id.toString(),
                    source: "subscription_checkout_flow",
                    utm_source: "google",
                    utm_email: "klaviyo",
                },
            });
        });

        it("should add the trial line item and trial days for a paid trial", async () => {
            const plan = await seedPlanWithPrices({ trial: true });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.body.message).toBe(
                "Paid + 3-day free trial Checkout session created",
            );
            expect(response.body.data.plan.paidTrial).toBe(true);
            expect(response.body.data.plan.freeTrialDays).toBe(3);
            expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    line_items: [
                        { price: "price_monthly", quantity: 1 },
                        { price: "price_trial", quantity: 1 },
                    ],
                    subscription_data: expect.objectContaining({
                        trial_period_days: 3,
                    }),
                }),
            );
        });

        it("should fall back to a regular subscription when the plan has no trial price", async () => {
            const plan = await seedPlanWithPrices();

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.body.message).toBe(
                "Trial requested but plan has no trial price — created regular subscription Checkout session",
            );
            expect(response.body.data.plan.trialRequested).toBe(true);
            expect(response.body.data.plan.trialHonored).toBe(false);
        });

        it("should use the yearly cadence for a trial on a yearly only plan", async () => {
            const plan = await seedPlanWithPrices({
                monthly: false,
                yearly: true,
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.body.data.plan.recurringCadence).toBe("yearly");
        });
    });

    describe("given a user with a saved card", () => {
        beforeEach(async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_saved",
                defaultPaymentMethodId: "pm_saved",
            });
        });

        it("should create the subscription after a successful payment", async () => {
            const plan = await seedPlanWithPrices();
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_ok",
                status: "succeeded",
            });
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_ok",
                status: "active",
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Subscription created with saved card",
            );
            expect(response.body.data.subscriptionId).toBe("sub_ok");
            expect(response.body.data.paymentMethod).toEqual({
                id: "pm_saved",
                saved: true,
            });
            expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
        });

        it("should anchor the next billing cycle for a regular subscription", async () => {
            const plan = await seedPlanWithPrices();
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_ok",
                status: "succeeded",
            });
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_ok",
                status: "active",
            });

            await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    proration_behavior: "none",
                    billing_cycle_anchor: expect.any(Number),
                }),
            );
        });

        it("should charge the trial price first for a paid trial", async () => {
            const plan = await seedPlanWithPrices({ trial: true });
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_ok",
                status: "succeeded",
            });
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_trial",
                status: "trialing",
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.body.message).toBe(
                "Paid + 3-day free trial subscription created with saved card",
            );
            expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 100, currency: "eur" }),
            );
            expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                expect.objectContaining({ trial_period_days: 3 }),
            );
        });

        it("should return the 3D Secure payload when the intent requires action", async () => {
            const plan = await seedPlanWithPrices();
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_3ds",
                status: "requires_action",
                client_secret: "pi_3ds_secret",
                payment_method: { id: "pm_new" },
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe(
                "3D Secure authentication required for subscription",
            );
            expect(response.body.data.subscriptionId).toBeNull();
            expect(response.body.data.status).toBe("incomplete");
            expect(response.body.data.requiresAction).toBe(true);
            expect(response.body.data.paymentMethodId).toBe("pm_new");
            expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
        });

        it("should return the 3D Secure payload when Stripe throws", async () => {
            const plan = await seedPlanWithPrices();
            const stripeError = new Error("authentication required");
            stripeError.code = "authentication_required";
            stripeError.raw = {
                payment_intent: {
                    id: "pi_thrown",
                    status: "requires_action",
                    client_secret: "pi_thrown_secret",
                    payment_method: "pm_thrown",
                },
            };
            mockStripe.paymentIntents.create.mockRejectedValue(stripeError);

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.body.message).toBe(
                "3D Secure authentication required for subscription",
            );
            expect(response.body.data.paymentIntentId).toBe("pi_thrown");
            expect(response.body.data.paymentMethodId).toBe("pm_thrown");
        });

        it("should return a 404 status code when Stripe cannot find the price", async () => {
            const plan = await seedPlanWithPrices();
            const stripeError = new Error("No such price");
            stripeError.type = "StripeInvalidRequestError";
            stripeError.code = "resource_missing";
            stripeError.raw = { param: "price" };
            mockStripe.paymentIntents.create.mockRejectedValue(stripeError);

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe(
                "Stripe price not found: price_monthly. The price may have been deleted in Stripe. Please verify the price exists in your Stripe account.",
            );
        });

        it("should fall through to a checkout session on an unexpected intent status", async () => {
            const plan = await seedPlanWithPrices();
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_weird",
                status: "canceled",
            });

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Subscription Checkout session created",
            );
        });
    });

    describe("given Stripe rejects the checkout session", () => {
        it("should return a 404 status code listing the missing prices", async () => {
            const plan = await seedPlanWithPrices({ trial: true });
            const stripeError = new Error("No such price");
            stripeError.type = "StripeInvalidRequestError";
            stripeError.code = "resource_missing";
            stripeError.raw = { param: "price" };
            mockStripe.checkout.sessions.create.mockRejectedValue(stripeError);

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "trial",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe(
                "Stripe price not found: price_monthly, price_trial. The price(s) may have been deleted in Stripe or do not exist. Please verify the prices exist in your Stripe account.",
            );
        });

        it("should propagate the Stripe status code", async () => {
            const plan = await seedPlanWithPrices();
            const stripeError = new Error("nope");
            stripeError.statusCode = 402;
            mockStripe.checkout.sessions.create.mockRejectedValue(stripeError);

            const response = await subscribe({
                planId: plan._id.toString(),
                type: "monthly",
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(402);
            expect(response.body.message).toBe("nope");
        });
    });

    describe("given Stripe is not configured", () => {
        it("should reject with the v1 message", async () => {
            const service = new StripeService(logger, null);

            await expect(
                service.createSubscription({
                    user,
                    planId: new mongoose.Types.ObjectId().toString(),
                    type: "monthly",
                    successUrl: "https://a",
                    cancelUrl: "https://b",
                }),
            ).rejects.toMatchObject({
                status: 500,
                message: "Stripe is not configured",
            });
        });
    });
});
