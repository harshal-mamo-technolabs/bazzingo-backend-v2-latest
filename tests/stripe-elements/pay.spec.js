const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

const mockStripe = {};

jest.mock("../../src/config/stripe", () => ({ getStripe: () => mockStripe }));

const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const User = require("../../src/modules/user/userModel");
const Order = require("../../src/modules/stripe/orderModel");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const stripeElementsRouter = require("../../src/modules/stripe-elements/stripeElementsRouter");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/stripe-elements", stripeElementsRouter);
    app.use(globalErrorHandler);

    return app;
};

const resetStripe = () => {
    mockStripe.customers = { create: jest.fn(), retrieve: jest.fn() };
    mockStripe.paymentIntents = { create: jest.fn(), retrieve: jest.fn() };
};

const createPrice = async (overrides = {}) =>
    await PriceCatalog.create({
        stripePriceId: `price_${Math.random().toString(16).slice(2)}`,
        stripeProductId: "prod_full",
        type: "one_time",
        currency: "EUR",
        unitAmount: 999,
        active: true,
        ...overrides,
    });

describe("POST /stripe-elements/pay", () => {
    useInMemoryDatabase();

    let app;
    let user;
    let token;

    beforeEach(async () => {
        resetStripe();
        app = buildApp();
        user = await createUser();
        token = getAccessToken(user._id);
        await User.findByIdAndUpdate(user._id, { stripeCustomerId: "cus_1" });
    });

    it("rejects an unauthenticated request", async () => {
        const res = await request(app)
            .post("/stripe-elements/pay")
            .send({ amount: 1000 });

        expect(res.status).toBe(401);
    });

    it("rejects a request without a usable amount source", async () => {
        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: 10 });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe(
            "Provide a valid priceCatalogId, or an integer `amount` of at least 50 (minor units / cents).",
        );
    });

    it("rejects an unknown price catalog id", async () => {
        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(new mongoose.Types.ObjectId()) });

        expect(res.status).toBe(404);
        expect(res.body.message).toBe("priceCatalogId not found or not active");
    });

    it("rejects a price below the stripe minimum", async () => {
        const price = await createPrice({ unitAmount: 10 });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(price._id) });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe(
            "Resolved price is below the Stripe minimum (50 cents)",
        );
    });

    it("charges the saved card in one click", async () => {
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockStripe.paymentIntents.create.mockResolvedValue({
            id: "pi_1",
            status: "succeeded",
        });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({
                amount: 1500,
                currency: "USD",
                productName: "Credit pack",
                itemType: "credit_pack",
                itemId: "pack-1",
                description: "Ten credits",
            });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("success");
        expect(res.body.message).toBe("Payment successful");

        const order = await Order.findOne({ userId: user._id }).lean();
        expect(res.body.data).toEqual({
            outcome: "paid",
            orderId: String(order._id),
            paymentIntentId: "pi_1",
            status: "succeeded",
            amount: 1500,
            currency: "usd",
        });
        expect(order.status).toBe("succeeded");
        expect(order.itemType).toBe("credit_pack");
        expect(order.itemId).toBe("pack-1");
        expect(order.productName).toBe("Credit pack");
        expect(order.description).toBe("Ten credits");

        expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
            expect.objectContaining({
                amount: 1500,
                currency: "usd",
                customer: "cus_1",
                payment_method: "pm_1",
                confirm: true,
                off_session: true,
                description: "Ten credits",
                payment_method_types: ["card"],
            }),
        );
    });

    it("asks for 3d secure when the off session charge needs it", async () => {
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockStripe.paymentIntents.create.mockResolvedValue({
            id: "pi_1",
            status: "requires_action",
            client_secret: "pi_1_secret",
        });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: 1500 });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("requires_action");
        expect(res.body.message).toBe("3D Secure authentication required");
        expect(res.body.data).toMatchObject({
            outcome: "requires_action",
            requiresAction: true,
            paymentIntentId: "pi_1",
            clientSecret: "pi_1_secret",
            paymentMethodId: "pm_1",
        });
    });

    it("returns pending for any other off session status", async () => {
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockStripe.paymentIntents.create.mockResolvedValue({
            id: "pi_1",
            status: "processing",
        });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: 1500 });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("pending");
        expect(res.body.message).toBe("Payment processing");
        expect(res.body.data).toMatchObject({
            outcome: "processing",
            paymentIntentId: "pi_1",
            status: "processing",
        });
    });

    it("recovers the client secret from an authentication error", async () => {
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockStripe.paymentIntents.create.mockRejectedValue(
            Object.assign(new Error("authentication required"), {
                code: "authentication_required",
                raw: {
                    payment_intent: {
                        id: "pi_3ds",
                        client_secret: "pi_3ds_secret",
                        status: "requires_action",
                    },
                },
            }),
        );

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: 1500 });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("requires_action");
        expect(res.body.data).toMatchObject({
            outcome: "requires_action",
            paymentIntentId: "pi_3ds",
            clientSecret: "pi_3ds_secret",
        });

        const order = await Order.findOne({ userId: user._id }).lean();
        expect(order.status).toBe("requires_action");
        expect(order.stripePaymentIntentId).toBe("pi_3ds");
    });

    it("falls back to collecting a card after a hard decline", async () => {
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockStripe.paymentIntents.create
            .mockRejectedValueOnce(
                Object.assign(new Error("Your card was declined."), {
                    type: "StripeCardError",
                    code: "card_declined",
                }),
            )
            .mockResolvedValueOnce({
                id: "pi_collect",
                client_secret: "pi_collect_secret",
            });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: 1500 });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("success");
        expect(res.body.message).toBe(
            "Enter card details to complete payment. Your card will be saved for one-click next time.",
        );
        expect(res.body.data).toMatchObject({
            outcome: "collect_payment_method",
            requiresPaymentMethod: true,
            paymentIntentId: "pi_collect",
            clientSecret: "pi_collect_secret",
            amount: 1500,
            currency: "eur",
        });

        const order = await Order.findOne({ userId: user._id }).lean();
        expect(order.status).toBe("requires_payment_method");
    });

    it("collects a card when there is no saved payment method", async () => {
        mockStripe.paymentIntents.create.mockResolvedValue({
            id: "pi_collect",
            client_secret: "pi_collect_secret",
        });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: 1500 });

        expect(res.status).toBe(200);
        expect(res.body.data.outcome).toBe("collect_payment_method");
        expect(mockStripe.paymentIntents.create).toHaveBeenCalledTimes(1);
        expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
            expect.objectContaining({
                setup_future_usage: "off_session",
                payment_method_types: ["card"],
            }),
        );
    });

    it("resolves the price of an assessment purchase server side", async () => {
        const assessment = await FullAssessment.create({
            mainCategory: "iq-test",
            questions: 10,
            subcategories: ["logic"],
            stripeProductId: "prod_full",
        });
        await createPrice({ default: true });
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockStripe.paymentIntents.create.mockResolvedValue({
            id: "pi_1",
            status: "succeeded",
        });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ assessmentId: String(assessment._id), amount: 1 });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            outcome: "paid",
            amount: 999,
            currency: "eur",
        });

        const order = await Order.findOne({ userId: user._id }).lean();
        expect(String(order.assessmentId)).toBe(String(assessment._id));
        expect(order.itemType).toBe("assessment");
        expect(order.itemId).toBe(String(assessment._id));
    });

    it("returns a server error when the collect intent cannot be created", async () => {
        mockStripe.paymentIntents.create.mockRejectedValue(new Error("boom"));

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: 1500 });

        expect(res.status).toBe(500);
        expect(res.body.message).toBe("Something went wrong");
    });
});
