const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const logger = require("../../src/config/logger");
const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const Order = require("../../src/modules/stripe/orderModel");
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

const seedAssessment = () =>
    FullAssessment.create({
        mainCategory: "iq-test",
        title: "IQ Test",
        questions: 20,
        subcategories: ["logic"],
        stripeProductId: "prod_assessment",
    });

const seedPrice = (assessmentId, overrides = {}) =>
    PriceCatalog.create({
        assessmentId,
        stripePriceId: `price_${Math.random().toString(36).slice(2)}`,
        stripeProductId: "prod_assessment",
        type: "one_time",
        currency: "EUR",
        unitAmount: 1999,
        productDuration: "onetime",
        active: true,
        default: true,
        ...overrides,
    });

describe("POST /stripe/checkout/session", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        token = getAccessToken(user._id);
        mockStripe.customers.create.mockResolvedValue({ id: "cus_new" });
        mockStripe.checkout.sessions.create.mockResolvedValue({
            id: "cs_test_1",
            url: "https://checkout.stripe.com/cs_test_1",
            customer: "cus_new",
        });
    });

    const checkout = (body, accessToken = token) =>
        request(app)
            .post("/stripe/checkout/session")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app)
                .post("/stripe/checkout/session")
                .send({});

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given an invalid body", () => {
        it("should return a 400 status code when assessmentId is missing", async () => {
            const response = await checkout({
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("assessmentId is required");
        });

        it("should return a 400 status code when successUrl is missing", async () => {
            const response = await checkout({
                assessmentId: new mongoose.Types.ObjectId().toString(),
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "successUrl and cancelUrl are required",
            );
        });

        it("should return a 400 status code when cancelUrl is missing", async () => {
            const response = await checkout({
                assessmentId: new mongoose.Types.ObjectId().toString(),
                successUrl: "https://a",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "successUrl and cancelUrl are required",
            );
        });
    });

    describe("given the assessment does not exist", () => {
        it("should return a 404 status code", async () => {
            const response = await checkout({
                assessmentId: new mongoose.Types.ObjectId().toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe("Assessment not found");
        });
    });

    describe("given the assessment has no active price", () => {
        it("should return a 404 status code", async () => {
            const assessment = await seedAssessment();

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe(
                "No active one-time price found for this assessment",
            );
        });

        it("should fall back to the newest active non default price", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id, { default: false });

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe("given a user without a saved card", () => {
        it("should return a 200 status code with the checkout session", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Checkout session created");
            expect(response.body.data.sessionId).toBe("cs_test_1");
            expect(response.body.data.url).toBe(
                "https://checkout.stripe.com/cs_test_1",
            );
            expect(response.body.data.orderId).toBeDefined();
        });

        it("should create a Stripe customer and persist it on the user", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);

            await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(mockStripe.customers.create).toHaveBeenCalledWith({
                email: user.email,
                name: user.name,
                metadata: {
                    userId: user._id.toString(),
                    source: "checkout_flow",
                },
            });

            const refreshed = await User.findById(user._id).lean();

            expect(refreshed.stripeCustomerId).toBe("cus_new");
        });

        it("should store the session on the order", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            const order = await Order.findById(
                response.body.data.orderId,
            ).lean();

            expect(order.stripeSessionId).toBe("cs_test_1");
            expect(order.status).toBe("requires_payment_method");
            expect(order.stripeCustomerId).toBe("cus_new");
        });

        it("should append the session placeholder to the success url", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);

            await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    mode: "payment",
                    success_url: "https://a?session_id={CHECKOUT_SESSION_ID}",
                    cancel_url: "https://b",
                    allow_promotion_codes: true,
                }),
            );
        });
    });

    describe("given a user with a saved card", () => {
        beforeEach(async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_saved",
                defaultPaymentMethodId: "pm_saved",
            });
        });

        it("should return a 200 status code when the payment succeeds", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                client_secret: "pi_1_secret",
            });

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Payment initiated with saved card",
            );
            expect(response.body.data.paymentIntentId).toBe("pi_1");
            expect(response.body.data.clientSecret).toBe("pi_1_secret");
            expect(response.body.data.status).toBe("succeeded");
            expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
        });

        it("should mark the order as processing for a pending payment", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_2",
                status: "processing",
                client_secret: "pi_2_secret",
            });

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.body.data.status).toBe("processing");
        });

        it("should return the requires_action envelope when 3D Secure is needed", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);
            const stripeError = new Error("authentication required");
            stripeError.code = "authentication_required";
            stripeError.raw = {
                payment_intent: {
                    id: "pi_3ds",
                    status: "requires_action",
                    client_secret: "pi_3ds_secret",
                    payment_method: "pm_3ds",
                },
            };
            mockStripe.paymentIntents.create.mockRejectedValue(stripeError);

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.status).toBe("requires_action");
            expect(response.body.message).toBe(
                "3D Secure authentication required",
            );
            expect(response.body.data.requiresAction).toBe(true);
            expect(response.body.data.clientSecret).toBe("pi_3ds_secret");
            expect(response.body.data.paymentMethodId).toBe("pm_3ds");

            const order = await Order.findById(
                response.body.data.orderId,
            ).lean();

            expect(order.status).toBe("requires_action");
            expect(order.stripePaymentIntentId).toBe("pi_3ds");
        });

        it("should retrieve the payment method when the intent does not carry one", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);
            const stripeError = new Error("authentication required");
            stripeError.code = "authentication_required";
            stripeError.raw = {
                payment_intent: {
                    id: "pi_3ds",
                    status: "requires_action",
                    client_secret: "pi_3ds_secret",
                },
            };
            mockStripe.paymentIntents.create.mockRejectedValue(stripeError);
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_3ds",
                payment_method: { id: "pm_fresh" },
            });

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.body.data.paymentMethodId).toBe("pm_fresh");
        });

        it("should fall back to the saved payment method when the retrieve fails", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);
            const stripeError = new Error("authentication required");
            stripeError.code = "authentication_required";
            stripeError.raw = {
                payment_intent: {
                    id: "pi_3ds",
                    status: "requires_action",
                    client_secret: "pi_3ds_secret",
                },
            };
            mockStripe.paymentIntents.create.mockRejectedValue(stripeError);
            mockStripe.paymentIntents.retrieve.mockRejectedValue(
                new Error("nope"),
            );

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.body.data.paymentMethodId).toBe("pm_saved");
        });

        it("should fall through to a checkout session for other failures", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);
            mockStripe.paymentIntents.create.mockRejectedValue(
                new Error("card declined"),
            );

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe("Checkout session created");
        });
    });

    describe("given Stripe rejects the checkout session", () => {
        it("should return a 404 status code for a missing price", async () => {
            const assessment = await seedAssessment();
            const price = await seedPrice(assessment._id);
            const stripeError = new Error("No such price");
            stripeError.type = "StripeInvalidRequestError";
            stripeError.code = "resource_missing";
            stripeError.raw = { param: "price" };
            mockStripe.checkout.sessions.create.mockRejectedValue(stripeError);

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe(
                `Stripe price not found: ${price.stripePriceId}. The price may have been deleted in Stripe or does not exist. Please update the PriceCatalog entry or create a new price.`,
            );
        });

        it("should propagate the Stripe status code", async () => {
            const assessment = await seedAssessment();
            await seedPrice(assessment._id);
            const stripeError = new Error("bad request");
            stripeError.statusCode = 402;
            mockStripe.checkout.sessions.create.mockRejectedValue(stripeError);

            const response = await checkout({
                assessmentId: assessment._id.toString(),
                successUrl: "https://a",
                cancelUrl: "https://b",
            });

            expect(response.statusCode).toBe(402);
            expect(response.body.message).toBe("bad request");
        });
    });

    describe("given Stripe is not configured", () => {
        it("should reject with the v1 message", async () => {
            const service = new StripeService(logger, null);

            await expect(
                service.createCheckoutOrOneClick({
                    user,
                    assessmentId: new mongoose.Types.ObjectId().toString(),
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
