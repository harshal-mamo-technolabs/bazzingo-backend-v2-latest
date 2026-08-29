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
const AdhdAssessment = require("../../src/modules/adhd-assessment/adhdAssessmentModel");
const EmotionalIntelligenceAssessment = require("../../src/modules/ei-assessment/emotionalIntelligenceAssessmentModel");
const stripeElementsRouter = require("../../src/modules/stripe-elements/stripeElementsRouter");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/stripe-elements", stripeElementsRouter);
    app.use(globalErrorHandler);

    return app;
};

const stripeError = (message, { type, code } = {}) =>
    Object.assign(new Error(message), { type, code });

const resetStripe = () => {
    mockStripe.customers = { create: jest.fn(), retrieve: jest.fn() };
    mockStripe.paymentIntents = { create: jest.fn(), retrieve: jest.fn() };
};

const createFullAssessment = async (overrides = {}) =>
    await FullAssessment.create({
        mainCategory: "iq-test",
        questions: 10,
        subcategories: ["logic"],
        stripeProductId: "prod_full",
        ...overrides,
    });

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

describe("stripe elements one time payment endpoints", () => {
    useInMemoryDatabase();

    let app;
    let user;
    let token;

    beforeEach(async () => {
        resetStripe();
        app = buildApp();
        user = await createUser();
        token = getAccessToken(user._id);
    });

    describe("POST /stripe-elements/create-payment", () => {
        beforeEach(() => {
            mockStripe.customers.create.mockResolvedValue({ id: "cus_new" });
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_1",
                client_secret: "pi_1_secret",
            });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .send({ assessmentId: String(new mongoose.Types.ObjectId()) });

            expect(res.status).toBe(401);
        });

        it("requires an assessment id", async () => {
            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("assessmentId is required");
        });

        it("returns not found for an unknown assessment", async () => {
            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(new mongoose.Types.ObjectId()) });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("Assessment not found");
        });

        it("returns not found when the assessment has no active price", async () => {
            const assessment = await createFullAssessment();

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe(
                "No active price found for this assessment",
            );
        });

        it("creates an order and a payment intent for a full assessment", async () => {
            const assessment = await createFullAssessment();
            const price = await createPrice({ default: true });

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe(
                "Payment intent created. Use clientSecret with Stripe Elements to collect payment.",
            );

            const order = await Order.findOne({ userId: user._id }).lean();
            expect(res.body.data).toEqual({
                orderId: String(order._id),
                paymentIntentId: "pi_1",
                clientSecret: "pi_1_secret",
                amount: 999,
                currency: "EUR",
                assessmentId: String(assessment._id),
                assessmentKind: "full",
                assessmentName: "iq-test",
                customerId: "cus_new",
                nextStep:
                    "Use clientSecret with Stripe Elements, then call stripe.confirmPayment()",
            });
            expect(order.status).toBe("requires_payment_method");
            expect(order.stripePaymentIntentId).toBe("pi_1");
            expect(String(order.priceCatalogId)).toBe(String(price._id));

            const saved = await User.findById(user._id).lean();
            expect(saved.stripeCustomerId).toBe("cus_new");

            expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    amount: 999,
                    currency: "eur",
                    customer: "cus_new",
                    description: "Assessment: iq-test",
                    setup_future_usage: "off_session",
                    payment_method_types: ["card"],
                }),
            );
        });

        it("resolves an adhd assessment through its price catalog entry", async () => {
            const price = await createPrice({
                stripeProductId: "prod_adhd",
                default: true,
            });
            const assessment = await AdhdAssessment.create({
                title: "ADHD",
                questions: 10,
                subCategories: ["inattention"],
                priceCatalogId: price._id,
            });

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({
                assessmentKind: "adhd",
                assessmentName: "ADHD",
            });
        });

        it("rejects a price catalog id that belongs to another adhd product", async () => {
            const base = await createPrice({
                stripeProductId: "prod_adhd",
                default: true,
            });
            const other = await createPrice({ stripeProductId: "prod_other" });
            const assessment = await AdhdAssessment.create({
                title: "ADHD",
                questions: 10,
                subCategories: ["inattention"],
                priceCatalogId: base._id,
            });

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    assessmentId: String(assessment._id),
                    priceCatalogId: String(other._id),
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "priceCatalogId does not match this ADHD assessment",
            );
        });

        it("fails when an adhd assessment has no resolvable stripe product", async () => {
            const assessment = await AdhdAssessment.create({
                title: "ADHD",
                questions: 10,
                subCategories: ["inattention"],
            });

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "Could not resolve Stripe product for ADHD assessment. Set priceCatalogId on the assessment or pass a valid priceCatalogId.",
            );
        });

        it("fails when an emotional intelligence assessment has no resolvable stripe product", async () => {
            const assessment = await EmotionalIntelligenceAssessment.create({
                title: "EI",
                questions: 10,
                subCategories: ["empathy"],
            });

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "Could not resolve Stripe product for emotional intelligence assessment. Set priceCatalogId on the assessment or pass a valid priceCatalogId.",
            );
        });

        it("rejects an inactive picked price for an emotional intelligence assessment", async () => {
            const price = await createPrice({
                stripeProductId: "prod_ei",
                default: true,
            });
            const inactive = await createPrice({
                stripeProductId: "prod_ei",
                active: false,
            });
            const assessment = await EmotionalIntelligenceAssessment.create({
                title: "EI",
                questions: 10,
                subCategories: ["empathy"],
                priceCatalogId: price._id,
            });

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    assessmentId: String(assessment._id),
                    priceCatalogId: String(inactive._id),
                });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("Price not found or not active");
        });

        it("maps an invalid stripe request to a bad request", async () => {
            const assessment = await createFullAssessment();
            await createPrice({ default: true });
            mockStripe.paymentIntents.create.mockRejectedValue(
                stripeError("Amount too small", {
                    type: "StripeInvalidRequestError",
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("Amount too small");
        });

        it("returns a server error when stripe fails unexpectedly", async () => {
            const assessment = await createFullAssessment();
            await createPrice({ default: true });
            mockStripe.paymentIntents.create.mockRejectedValue(
                new Error("boom"),
            );

            const res = await request(app)
                .post("/stripe-elements/create-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(500);
        });
    });

    describe("GET /stripe-elements/payment-status/:orderId", () => {
        let assessment;
        let order;

        beforeEach(async () => {
            assessment = await createFullAssessment();
            order = await Order.create({
                userId: user._id,
                assessmentId: assessment._id,
                currency: "EUR",
                unitAmount: 999,
                status: "requires_payment_method",
                stripePaymentIntentId: "pi_1",
            });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app).get(
                `/stripe-elements/payment-status/${order._id}`,
            );

            expect(res.status).toBe(401);
        });

        it("returns not found for an unknown order", async () => {
            const res = await request(app)
                .get(
                    `/stripe-elements/payment-status/${new mongoose.Types.ObjectId()}`,
                )
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("Order not found");
        });

        it("rejects an order that belongs to somebody else", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            const otherOrder = await Order.create({
                userId: other._id,
                currency: "EUR",
                unitAmount: 999,
            });

            const res = await request(app)
                .get(`/stripe-elements/payment-status/${otherOrder._id}`)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(res.body.message).toBe(
                "This order does not belong to your account",
            );
        });

        it("returns a server error for a malformed order id", async () => {
            const res = await request(app)
                .get("/stripe-elements/payment-status/not-an-id")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(500);
        });

        it("syncs the order status from the payment intent", async () => {
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
            });

            const res = await request(app)
                .get(`/stripe-elements/payment-status/${order._id}`)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Payment status retrieved");
            expect(res.body.data).toMatchObject({
                orderId: String(order._id),
                status: "succeeded",
                paymentIntentId: "pi_1",
                paymentStatus: "succeeded",
                amount: 999,
                currency: "EUR",
                assessmentId: String(assessment._id),
                assessmentName: "iq-test",
                requiresAction: false,
                clientSecret: null,
            });

            const saved = await Order.findById(order._id).lean();
            expect(saved.status).toBe("succeeded");
        });

        it("returns the client secret when 3d secure is pending", async () => {
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "requires_action",
                client_secret: "pi_1_secret",
            });

            const res = await request(app)
                .get(`/stripe-elements/payment-status/${order._id}`)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.requiresAction).toBe(true);
            expect(res.body.data.clientSecret).toBe("pi_1_secret");
        });

        it("returns a server error when stripe fails", async () => {
            mockStripe.paymentIntents.retrieve.mockRejectedValue(
                new Error("boom"),
            );

            const res = await request(app)
                .get(`/stripe-elements/payment-status/${order._id}`)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(500);
        });
    });

    describe("POST /stripe-elements/confirm-payment", () => {
        let assessment;
        let order;

        beforeEach(async () => {
            assessment = await createFullAssessment();
            order = await Order.create({
                userId: user._id,
                assessmentId: assessment._id,
                currency: "EUR",
                unitAmount: 999,
                status: "requires_action",
                stripePaymentIntentId: "pi_1",
            });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .send({ orderId: String(order._id) });

            expect(res.status).toBe(401);
        });

        it("requires an order id", async () => {
            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("orderId is required");
        });

        it("returns not found for an unknown order", async () => {
            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ orderId: String(new mongoose.Types.ObjectId()) });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("Order not found");
        });

        it("rejects an order that belongs to somebody else", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            const otherOrder = await Order.create({
                userId: other._id,
                currency: "EUR",
                unitAmount: 999,
                stripePaymentIntentId: "pi_2",
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ orderId: String(otherOrder._id) });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe(
                "This order does not belong to your account",
            );
        });

        it("rejects an order without a payment intent", async () => {
            const bare = await Order.create({
                userId: user._id,
                currency: "EUR",
                unitAmount: 999,
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ orderId: String(bare._id) });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "No payment intent found for this order",
            );
        });

        it("confirms a successful payment and stores the default card", async () => {
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                payment_method: "pm_1",
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ orderId: String(order._id), paymentIntentId: "pi_1" });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Payment successful!");
            expect(res.body.data).toEqual({
                orderId: String(order._id),
                status: "succeeded",
                paymentIntentId: "pi_1",
                amount: 999,
                currency: "EUR",
                assessmentId: String(assessment._id),
                assessmentName: "iq-test",
            });

            const savedOrder = await Order.findById(order._id).lean();
            expect(savedOrder.status).toBe("succeeded");

            const savedUser = await User.findById(user._id).lean();
            expect(savedUser.defaultPaymentMethodId).toBe("pm_1");
        });

        it("reports that 3d secure is required", async () => {
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "requires_action",
                client_secret: "pi_1_secret",
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ orderId: String(order._id) });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("requires_action");
            expect(res.body.message).toBe("3D Secure authentication required");
            expect(res.body.data).toEqual({
                orderId: String(order._id),
                status: "requires_action",
                requiresAction: true,
                clientSecret: "pi_1_secret",
                paymentIntentId: "pi_1",
            });
        });

        it("reports a failed payment", async () => {
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "requires_payment_method",
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ orderId: String(order._id) });

            expect(res.status).toBe(400);
            expect(res.body.status).toBe("error");
            expect(res.body.message).toBe(
                "Payment failed. Please try a different payment method.",
            );
            expect(res.body.data).toEqual({
                orderId: String(order._id),
                status: "requires_payment_method",
                paymentIntentId: "pi_1",
            });
        });

        it("returns a pending fallback for any other payment status", async () => {
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_1",
                status: "processing",
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ orderId: String(order._id) });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("pending");
            expect(res.body.message).toBe("Payment status: processing");
            expect(res.body.data).toEqual({
                orderId: String(order._id),
                status: "processing",
                paymentIntentId: "pi_1",
                paymentStatus: "processing",
            });
        });

        it("returns a server error when stripe fails", async () => {
            mockStripe.paymentIntents.retrieve.mockRejectedValue(
                new Error("boom"),
            );

            const res = await request(app)
                .post("/stripe-elements/confirm-payment")
                .set("Authorization", `Bearer ${token}`)
                .send({ orderId: String(order._id) });

            expect(res.status).toBe(500);
        });
    });

    describe("GET /stripe-elements/my-orders", () => {
        it("rejects an unauthenticated request", async () => {
            const res = await request(app).get("/stripe-elements/my-orders");

            expect(res.status).toBe(401);
        });

        it("lists the orders of the authenticated user", async () => {
            const assessment = await createFullAssessment();
            const price = await createPrice();
            const order = await Order.create({
                userId: user._id,
                assessmentId: assessment._id,
                priceCatalogId: price._id,
                currency: "EUR",
                unitAmount: 999,
                status: "succeeded",
                stripePaymentIntentId: "pi_1",
            });
            const other = await createUser({ email: "other@bazzingo.com" });
            await Order.create({
                userId: other._id,
                currency: "EUR",
                unitAmount: 999,
            });

            const res = await request(app)
                .get("/stripe-elements/my-orders")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Orders retrieved");
            expect(res.body.data.total).toBe(1);
            expect(res.body.data.orders[0]).toMatchObject({
                orderId: String(order._id),
                status: "succeeded",
                amount: 999,
                currency: "EUR",
                assessmentId: String(assessment._id),
                assessmentName: "iq-test",
                paymentIntentId: "pi_1",
            });
        });
    });

    describe("POST /stripe-elements/quick-pay", () => {
        let assessment;

        beforeEach(async () => {
            assessment = await createFullAssessment();
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_1",
                defaultPaymentMethodId: "pm_1",
            });
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_1",
                status: "succeeded",
                client_secret: "pi_1_secret",
            });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(401);
        });

        it("requires an assessment id", async () => {
            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("assessmentId is required");
        });

        it("requires a saved payment method", async () => {
            await User.findByIdAndUpdate(user._id, {
                defaultPaymentMethodId: null,
            });

            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "No payment method available. Please add a card first.",
            );
        });

        it("requires a stripe customer", async () => {
            await User.findByIdAndUpdate(user._id, {
                $unset: { stripeCustomerId: 1 },
            });

            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "No Stripe customer found. Please complete a payment first.",
            );
        });

        it("returns not found for an unknown assessment", async () => {
            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(new mongoose.Types.ObjectId()) });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("Assessment not found");
        });

        it("returns not found when there is no active price", async () => {
            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe(
                "No active price found for this assessment",
            );
        });

        it("charges the saved card", async () => {
            await createPrice({ default: true });

            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Payment successful!");

            const order = await Order.findOne({ userId: user._id }).lean();
            expect(order.status).toBe("succeeded");
            expect(res.body.data).toEqual({
                orderId: String(order._id),
                status: "succeeded",
                paymentIntentId: "pi_1",
                amount: 999,
                currency: "EUR",
                assessmentId: String(assessment._id),
                assessmentName: "iq-test",
            });

            expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    customer: "cus_1",
                    payment_method: "pm_1",
                    confirm: true,
                    off_session: true,
                    payment_method_types: ["card"],
                }),
            );
        });

        it("reports when additional authentication is required", async () => {
            await createPrice({ default: true });
            mockStripe.paymentIntents.create.mockResolvedValue({
                id: "pi_1",
                status: "requires_action",
                client_secret: "pi_1_secret",
            });

            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("requires_action");
            expect(res.body.message).toBe("Additional authentication required");
            expect(res.body.data).toMatchObject({
                status: "requires_action",
                paymentIntentId: "pi_1",
                clientSecret: "pi_1_secret",
                requiresAction: true,
            });

            const order = await Order.findOne({ userId: user._id }).lean();
            expect(order.status).toBe("processing");
        });

        it("maps a declined card to a bad request", async () => {
            await createPrice({ default: true });
            mockStripe.paymentIntents.create.mockRejectedValue(
                stripeError("Your card was declined.", {
                    type: "StripeCardError",
                    code: "card_declined",
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("Your card was declined.");
        });

        it("returns a server error when stripe fails unexpectedly", async () => {
            await createPrice({ default: true });
            mockStripe.paymentIntents.create.mockRejectedValue(
                new Error("boom"),
            );

            const res = await request(app)
                .post("/stripe-elements/quick-pay")
                .set("Authorization", `Bearer ${token}`)
                .send({ assessmentId: String(assessment._id) });

            expect(res.status).toBe(500);
        });
    });
});
