const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

const mockStripe = {};

jest.mock("../../src/config/stripe", () => ({ getStripe: () => mockStripe }));

const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const { mockPricePayment } = require("../utils/stripeMocks");
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

    it("rejects a client-sent amount without a catalog price", async () => {
        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ amount: 1 });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe(
            "Provide an assessmentId or a one-time priceCatalogId",
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

    it("rejects a recurring catalog price", async () => {
        const price = await createPrice({ type: "recurring" });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(price._id) });

        expect(res.status).toBe(404);
    });

    it("does not carry old email attribution into organic one-click purchases", async () => {
        const price = await createPrice({ unitAmount: 1500 });
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
            flowId: "OLD_FLOW",
            utmEmail: "Klaviyo",
        });
        mockPricePayment(mockStripe, { id: "pi_regression", status: "succeeded" });
        for (const attribution of [
            {},
            { flow_id: "CURRENT_FLOW", utm_email: "Klaviyo" },
            {},
        ]) {
            const response = await request(app)
                .post("/stripe-elements/pay")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    priceCatalogId: String(price._id),
                    productName: "Assessment",
                    itemType: "assessment",
                    itemId: "assessment-1",
                    ...attribution,
                });
            expect(response.status).toBe(200);
            const metadata =
                mockStripe.paymentIntents.update.mock.calls.at(-1)[1].metadata;
            expect(metadata).toMatchObject({
                utm_source: "organic",
                utm_campaign: "organic",
                utm_medium: "organic",
            });
            if (attribution.flow_id) {
                expect(metadata).toMatchObject(attribution);
            } else {
                expect(metadata).not.toHaveProperty("flow_id");
                expect(metadata).not.toHaveProperty("utm_email");
            }
        }
        expect((await User.findById(user._id)).flowId).toBe("OLD_FLOW");
    });

    it("charges the saved card in one click for the catalog price", async () => {
        const price = await createPrice({ unitAmount: 1500, currency: "USD" });
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockPricePayment(mockStripe, { id: "pi_1", status: "succeeded" });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({
                priceCatalogId: String(price._id),
                amount: 1,
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

        expect(mockStripe.invoiceItems.create).toHaveBeenCalledWith(
            expect.objectContaining({
                customer: "cus_1",
                pricing: { price: price.stripePriceId },
            }),
        );
        expect(mockStripe.invoices.pay).toHaveBeenCalledWith("in_1", {
            payment_method: "pm_1",
            off_session: true,
        });
        expect(mockStripe.paymentIntents.update).toHaveBeenCalledWith(
            "pi_1",
            expect.objectContaining({ description: "Ten credits" }),
        );
    });

    it("asks for 3d secure when the off session charge needs it", async () => {
        const price = await createPrice();
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockPricePayment(mockStripe, {
            id: "pi_1",
            status: "requires_action",
            client_secret: "pi_1_secret",
        });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(price._id) });

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
        const price = await createPrice();
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockPricePayment(mockStripe, { id: "pi_1", status: "processing" });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(price._id) });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("pending");
        expect(res.body.message).toBe("Payment processing");
        expect(res.body.data).toMatchObject({
            outcome: "processing",
            paymentIntentId: "pi_1",
            status: "processing",
        });
    });

    it("recovers the client secret when the invoice payment needs authentication", async () => {
        const price = await createPrice();
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockPricePayment(mockStripe, {
            id: "pi_3ds",
            client_secret: "pi_3ds_secret",
            status: "requires_action",
        });
        mockStripe.invoices.pay.mockRejectedValue(
            Object.assign(new Error("requires action"), {
                type: "StripeCardError",
                code: "invoice_payment_intent_requires_action",
            }),
        );

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(price._id) });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("requires_action");
        expect(res.body.data).toMatchObject({
            outcome: "requires_action",
            paymentIntentId: "pi_3ds",
            clientSecret: "pi_3ds_secret",
        });
        expect(mockStripe.invoices.voidInvoice).not.toHaveBeenCalled();

        const order = await Order.findOne({ userId: user._id }).lean();
        expect(order.status).toBe("requires_action");
        expect(order.stripePaymentIntentId).toBe("pi_3ds");
    });

    it("voids the declined invoice and falls back to collecting a card", async () => {
        const price = await createPrice({ unitAmount: 1500 });
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockPricePayment(mockStripe, {
            id: "pi_collect",
            client_secret: "pi_collect_secret",
            status: "requires_payment_method",
        });
        mockStripe.invoices.pay.mockRejectedValue(
            Object.assign(new Error("Your card was declined."), {
                type: "StripeCardError",
                code: "card_declined",
            }),
        );

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(price._id) });

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
        expect(mockStripe.invoices.voidInvoice).toHaveBeenCalledWith("in_1");
        expect(mockStripe.invoices.create).toHaveBeenCalledTimes(2);

        const order = await Order.findOne({ userId: user._id }).lean();
        expect(order.status).toBe("requires_payment_method");
    });

    it("collects a card when there is no saved payment method", async () => {
        const price = await createPrice();
        mockPricePayment(mockStripe, {
            id: "pi_collect",
            client_secret: "pi_collect_secret",
        });

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(price._id) });

        expect(res.status).toBe(200);
        expect(res.body.data.outcome).toBe("collect_payment_method");
        expect(mockStripe.invoices.pay).not.toHaveBeenCalled();
        expect(mockStripe.paymentIntents.update).toHaveBeenCalledWith(
            "pi_collect",
            expect.objectContaining({ setup_future_usage: "off_session" }),
        );
    });

    it("resolves the price of an assessment purchase server side", async () => {
        const assessment = await FullAssessment.create({
            mainCategory: "iq-test",
            questions: 10,
            subcategories: ["logic"],
            stripeProductId: "prod_full",
        });
        const price = await createPrice({ default: true });
        await User.findByIdAndUpdate(user._id, {
            defaultPaymentMethodId: "pm_1",
        });
        mockPricePayment(mockStripe, { id: "pi_1", status: "succeeded" });

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
        expect(mockStripe.invoiceItems.create).toHaveBeenCalledWith(
            expect.objectContaining({ pricing: { price: price.stripePriceId } }),
        );

        const order = await Order.findOne({ userId: user._id }).lean();
        expect(String(order.assessmentId)).toBe(String(assessment._id));
        expect(order.itemType).toBe("assessment");
        expect(order.itemId).toBe(String(assessment._id));
    });

    it("returns a server error when the collect invoice cannot be created", async () => {
        const price = await createPrice();
        mockPricePayment(mockStripe, { id: "pi_1" });
        mockStripe.invoices.create.mockRejectedValue(new Error("boom"));

        const res = await request(app)
            .post("/stripe-elements/pay")
            .set("Authorization", `Bearer ${token}`)
            .send({ priceCatalogId: String(price._id) });

        expect(res.status).toBe(500);
        expect(res.body.message).toBe("Something went wrong");
    });
});
