const request = require("supertest");
const express = require("express");

const mockStripe = {};

jest.mock("../../src/config/stripe", () => ({ getStripe: () => mockStripe }));

const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const User = require("../../src/modules/user/userModel");
const Subscription = require("../../src/modules/stripe/subscriptionModel");
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
    mockStripe.customers = { create: jest.fn(), retrieve: jest.fn(), update: jest.fn() };
    mockStripe.setupIntents = { create: jest.fn(), retrieve: jest.fn() };
    mockStripe.paymentMethods = { list: jest.fn(), retrieve: jest.fn(), detach: jest.fn() };
    mockStripe.subscriptions = { update: jest.fn() };
};

describe("stripe elements payment method endpoints", () => {
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

    describe("GET /stripe-elements/payment-methods", () => {
        it("returns an empty list when the user has no stripe customer", async () => {
            const res = await request(app)
                .get("/stripe-elements/payment-methods")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ paymentMethods: [] });
            expect(mockStripe.paymentMethods.list).not.toHaveBeenCalled();
        });

        it("lists cards and flags the default one, sorted first", async () => {
            user.stripeCustomerId = "cus_1";
            user.defaultPaymentMethodId = "pm_2";
            await user.save();

            mockStripe.paymentMethods.list.mockResolvedValue({
                data: [
                    { id: "pm_1", card: { brand: "visa", last4: "1111", exp_month: 1, exp_year: 2030 } },
                    { id: "pm_2", card: { brand: "mastercard", last4: "4444", exp_month: 2, exp_year: 2031 } },
                ],
            });

            const res = await request(app)
                .get("/stripe-elements/payment-methods")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.paymentMethods).toEqual([
                { id: "pm_2", brand: "mastercard", last4: "4444", expMonth: 2, expYear: 2031, isDefault: true },
                { id: "pm_1", brand: "visa", last4: "1111", expMonth: 1, expYear: 2030, isDefault: false },
            ]);
            expect(mockStripe.paymentMethods.list).toHaveBeenCalledWith({
                customer: "cus_1",
                type: "card",
            });
        });
    });

    describe("POST /stripe-elements/payment-methods/setup-intent", () => {
        it("creates a stripe customer if needed and returns a client secret", async () => {
            mockStripe.customers.create.mockResolvedValue({ id: "cus_new" });
            mockStripe.setupIntents.create.mockResolvedValue({
                id: "seti_1",
                client_secret: "seti_1_secret",
            });

            const res = await request(app)
                .post("/stripe-elements/payment-methods/setup-intent")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({
                clientSecret: "seti_1_secret",
                setupIntentId: "seti_1",
            });
            expect(mockStripe.setupIntents.create).toHaveBeenCalledWith(
                expect.objectContaining({ customer: "cus_new", usage: "off_session" }),
            );

            const updated = await User.findById(user._id);
            expect(updated.stripeCustomerId).toBe("cus_new");
        });
    });

    describe("POST /stripe-elements/payment-methods/confirm", () => {
        it("requires a setupIntentId", async () => {
            const res = await request(app)
                .post("/stripe-elements/payment-methods/confirm")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
        });

        it("rejects a setup intent that has not succeeded", async () => {
            mockStripe.setupIntents.retrieve.mockResolvedValue({
                id: "seti_1",
                status: "requires_action",
            });

            const res = await request(app)
                .post("/stripe-elements/payment-methods/confirm")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(400);
        });

        it("saves the card as default when the user has none yet", async () => {
            user.stripeCustomerId = "cus_1";
            await user.save();

            mockStripe.setupIntents.retrieve.mockResolvedValue({
                id: "seti_1",
                status: "succeeded",
                customer: "cus_1",
                payment_method: "pm_new",
            });
            mockStripe.customers.update.mockResolvedValue({});
            mockStripe.paymentMethods.list.mockResolvedValue({
                data: [{ id: "pm_new", card: { brand: "visa", last4: "9999" } }],
            });

            const res = await request(app)
                .post("/stripe-elements/payment-methods/confirm")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(200);
            expect(res.body.data.paymentMethodId).toBe("pm_new");
            expect(res.body.data.paymentMethods[0].isDefault).toBe(true);
            expect(mockStripe.customers.update).toHaveBeenCalledWith("cus_1", {
                invoice_settings: { default_payment_method: "pm_new" },
            });

            const updated = await User.findById(user._id);
            expect(updated.defaultPaymentMethodId).toBe("pm_new");
        });

        it("does not overwrite an existing default", async () => {
            user.stripeCustomerId = "cus_1";
            user.defaultPaymentMethodId = "pm_old";
            await user.save();

            mockStripe.setupIntents.retrieve.mockResolvedValue({
                id: "seti_1",
                status: "succeeded",
                customer: "cus_1",
                payment_method: "pm_new",
            });
            mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });

            await request(app)
                .post("/stripe-elements/payment-methods/confirm")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(mockStripe.customers.update).not.toHaveBeenCalled();
        });
    });

    describe("DELETE /stripe-elements/payment-methods/:paymentMethodId", () => {
        it("rejects a card that does not belong to the user", async () => {
            user.stripeCustomerId = "cus_1";
            await user.save();

            mockStripe.paymentMethods.retrieve.mockResolvedValue({
                id: "pm_1",
                customer: "cus_other",
            });

            const res = await request(app)
                .delete("/stripe-elements/payment-methods/pm_1")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(mockStripe.paymentMethods.detach).not.toHaveBeenCalled();
        });

        it("detaches the card and clears the default when it was the default", async () => {
            user.stripeCustomerId = "cus_1";
            user.defaultPaymentMethodId = "pm_1";
            await user.save();

            mockStripe.paymentMethods.retrieve.mockResolvedValue({
                id: "pm_1",
                customer: "cus_1",
            });
            mockStripe.paymentMethods.detach.mockResolvedValue({});
            mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });

            const res = await request(app)
                .delete("/stripe-elements/payment-methods/pm_1")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith("pm_1");

            const updated = await User.findById(user._id);
            expect(updated.defaultPaymentMethodId).toBeNull();
        });
    });

    describe("PATCH /stripe-elements/payment-methods/:paymentMethodId/default", () => {
        it("rejects a card that does not belong to the user", async () => {
            user.stripeCustomerId = "cus_1";
            await user.save();

            mockStripe.paymentMethods.retrieve.mockResolvedValue({
                id: "pm_1",
                customer: "cus_other",
            });

            const res = await request(app)
                .patch("/stripe-elements/payment-methods/pm_1/default")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(403);
        });

        it("switches the default payment method used for one-click pay", async () => {
            user.stripeCustomerId = "cus_1";
            user.defaultPaymentMethodId = "pm_old";
            await user.save();

            mockStripe.paymentMethods.retrieve.mockResolvedValue({
                id: "pm_new",
                customer: "cus_1",
            });
            mockStripe.customers.update.mockResolvedValue({});
            mockStripe.paymentMethods.list.mockResolvedValue({
                data: [
                    { id: "pm_old", card: { brand: "visa", last4: "1111" } },
                    { id: "pm_new", card: { brand: "visa", last4: "2222" } },
                ],
            });

            const res = await request(app)
                .patch("/stripe-elements/payment-methods/pm_new/default")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(
                res.body.data.paymentMethods.find((m) => m.id === "pm_new")
                    .isDefault,
            ).toBe(true);

            const updated = await User.findById(user._id);
            expect(updated.defaultPaymentMethodId).toBe("pm_new");
        });

        it("repoints an ongoing subscription's default_payment_method so renewals follow the switch", async () => {
            user.stripeCustomerId = "cus_1";
            user.defaultPaymentMethodId = "pm_old";
            await user.save();

            await Subscription.create({
                userId: user._id,
                stripeSubscriptionId: "sub_active_1",
                status: "active",
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(),
            });
            await Subscription.create({
                userId: user._id,
                stripeSubscriptionId: "sub_cancelled_1",
                status: "canceled",
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(),
            });

            mockStripe.paymentMethods.retrieve.mockResolvedValue({
                id: "pm_new",
                customer: "cus_1",
            });
            mockStripe.customers.update.mockResolvedValue({});
            mockStripe.subscriptions.update.mockResolvedValue({});
            mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });

            const res = await request(app)
                .patch("/stripe-elements/payment-methods/pm_new/default")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(mockStripe.subscriptions.update).toHaveBeenCalledTimes(1);
            expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
                "sub_active_1",
                { default_payment_method: "pm_new" },
            );
        });

        it("still saves the default card when syncing to a subscription fails", async () => {
            user.stripeCustomerId = "cus_1";
            await user.save();

            await Subscription.create({
                userId: user._id,
                stripeSubscriptionId: "sub_active_1",
                status: "trialing",
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(),
            });

            mockStripe.paymentMethods.retrieve.mockResolvedValue({
                id: "pm_new",
                customer: "cus_1",
            });
            mockStripe.customers.update.mockResolvedValue({});
            mockStripe.subscriptions.update.mockRejectedValue(
                new Error("stripe is down"),
            );
            mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });

            const res = await request(app)
                .patch("/stripe-elements/payment-methods/pm_new/default")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);

            const updated = await User.findById(user._id);
            expect(updated.defaultPaymentMethodId).toBe("pm_new");
        });
    });
});
