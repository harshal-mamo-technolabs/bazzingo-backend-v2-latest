const request = require("supertest");
const express = require("express");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
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

const PERIOD_START = 1893456000;
const PERIOD_END = 1896134400;

const seedSubscription = (userId, overrides = {}) =>
    Subscription.create({
        userId,
        stripeSubscriptionId: "sub_trial",
        status: "trialing",
        planDuration: "monthly",
        currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
        ...overrides,
    });

describe("POST /stripe/end-trial-pro", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const endTrial = (accessToken = token) =>
        request(app)
            .post("/stripe/end-trial-pro")
            .set("Authorization", `Bearer ${accessToken}`)
            .send({});

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app)
                .post("/stripe/end-trial-pro")
                .send({});

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given the user has no trial subscription", () => {
        it("should return a 404 status code with the v1 body", async () => {
            const response = await endTrial();

            expect(response.statusCode).toBe(404);
            expect(response.body.status).toBe("error");
            expect(response.body.message).toBe(
                "No active trial subscription found",
            );
            expect(response.body.data.step).toBe("find_subscription");
            expect(response.body.data.error).toBe(
                "No subscription with status trialing or past_due",
            );
            expect(response.body.data.requestId).toMatch(/^req_\d+_/);
        });
    });

    describe("given Stripe cannot be reached", () => {
        it("should return a 500 status code with the v1 message", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockRejectedValue(
                new Error("stripe down"),
            );

            const response = await endTrial();

            expect(response.statusCode).toBe(500);
            expect(response.body.status).toBe("error");
            expect(response.body.message).toBe(
                "Failed to retrieve subscription from Stripe",
            );
            expect(response.body.data.processingTime).toMatch(/ms$/);
        });
    });

    describe("given Stripe reports an unusable status", () => {
        it("should return a 400 status code", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "canceled",
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Cannot end trial. Subscription status is canceled",
            );
            expect(response.body.data.step).toBe("validate_status");
            expect(response.body.data.localStatus).toBe("trialing");
            expect(response.body.data.stripeStatus).toBe("canceled");
        });
    });

    describe("given the latest invoice requires 3D Secure", () => {
        it("should return a 200 status code asking for authentication", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "trialing",
                latest_invoice: {
                    id: "in_1",
                    payment_intent: {
                        id: "pi_3ds",
                        status: "requires_action",
                        client_secret: "pi_3ds_secret",
                        payment_method: "pm_1",
                        amount: 1999,
                        currency: "eur",
                    },
                },
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe(
                "3D Secure authentication required before ending trial",
            );
            expect(response.body.data.action).toBe(
                "requires_3ds_authentication",
            );
            expect(response.body.data.authentication).toEqual({
                required: true,
                clientSecret: "pi_3ds_secret",
                paymentIntentId: "pi_3ds",
                paymentMethodId: "pm_1",
                amount: 1999,
                currency: "eur",
            });
            expect(response.body.data.nextStep).toBe(
                "Complete 3DS authentication, then call this API again",
            );
            expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
        });
    });

    describe("given the trial can be ended immediately", () => {
        it("should return a 200 status code and activate the subscription", async () => {
            const subscription = await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "trialing",
            });
            mockStripe.subscriptions.update.mockResolvedValue({
                id: "sub_trial",
                status: "active",
                current_period_start: PERIOD_START,
                current_period_end: PERIOD_END,
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Trial ended successfully. Subscription is now active.",
            );
            expect(response.body.data.action).toBe("trial_ended_successfully");
            expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
                "sub_trial",
                { trial_end: "now" },
            );

            const refreshed = await Subscription.findById(
                subscription._id,
            ).lean();

            expect(refreshed.status).toBe("active");
            expect(refreshed.currentPeriodEnd.toISOString()).toBe(
                new Date(PERIOD_END * 1000).toISOString(),
            );
            expect(refreshed.nextBillingDate.toISOString()).toBe(
                new Date(PERIOD_END * 1000).toISOString(),
            );
        });

        it("should derive the period end from the plan duration", async () => {
            const subscription = await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "trialing",
            });
            mockStripe.subscriptions.update.mockResolvedValue({
                id: "sub_trial",
                status: "active",
            });

            await endTrial();

            const refreshed = await Subscription.findById(
                subscription._id,
            ).lean();
            const days =
                (refreshed.currentPeriodEnd.getTime() -
                    refreshed.currentPeriodStart.getTime()) /
                86400000;

            expect(days).toBeGreaterThanOrEqual(28);
            expect(days).toBeLessThanOrEqual(31);
        });

        it("should report an unexpected status after the trial end", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "trialing",
            });
            mockStripe.subscriptions.update.mockResolvedValue({
                id: "sub_trial",
                status: "incomplete",
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Trial processing completed with status: incomplete",
            );
            expect(response.body.data.action).toBe("unexpected_status");
            expect(response.body.data.error).toBe(
                "Unexpected status after trial end: incomplete",
            );
        });

        it("should return a 500 status code when the Stripe update throws", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "trialing",
            });
            mockStripe.subscriptions.update.mockRejectedValue(
                new Error("stripe blew up"),
            );

            const response = await endTrial();

            expect(response.statusCode).toBe(500);
            expect(response.body.message).toBe(
                "Internal server error occurred while processing trial end",
            );
            expect(response.body.data.error).toBe("Internal server error");
        });
    });

    describe("given the subscription lands in past_due", () => {
        beforeEach(async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "trialing",
            });
            mockStripe.subscriptions.update.mockResolvedValue({
                id: "sub_trial",
                status: "past_due",
                latest_invoice: "in_past_due",
            });
        });

        it("should ask for 3D Secure when the invoice intent requires action", async () => {
            mockStripe.invoices.retrieve.mockResolvedValue({
                id: "in_past_due",
                amount_due: 1999,
                currency: "eur",
                status: "open",
                payment_intent: {
                    id: "pi_open",
                    status: "requires_action",
                    client_secret: "pi_open_secret",
                    payment_method: "pm_1",
                    amount: 1999,
                    currency: "eur",
                },
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Trial ended, but 3D Secure authentication required to activate subscription",
            );
            expect(response.body.data.nextStep).toBe(
                "Complete 3DS authentication to activate subscription",
            );

            const refreshed = await Subscription.findOne({
                userId: user._id,
            }).lean();

            expect(refreshed.status).toBe("past_due");
        });

        it("should pay the invoice and activate the subscription", async () => {
            mockStripe.invoices.retrieve.mockResolvedValue({
                id: "in_past_due",
                amount_due: 1999,
                currency: "eur",
                status: "open",
            });
            mockStripe.invoices.pay.mockResolvedValue({
                id: "in_past_due",
                status: "paid",
                amount_paid: 1999,
                currency: "eur",
            });
            mockStripe.subscriptions.retrieve
                .mockResolvedValueOnce({
                    id: "sub_trial",
                    status: "trialing",
                })
                .mockResolvedValueOnce({
                    id: "sub_trial",
                    status: "active",
                    current_period_start: PERIOD_START,
                    current_period_end: PERIOD_END,
                });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Trial ended and subscription activated successfully!",
            );
            expect(response.body.data.action).toBe("subscription_activated");
            expect(response.body.data.payment).toEqual(
                expect.objectContaining({
                    successful: true,
                    invoiceId: "in_past_due",
                    amountPaid: 1999,
                    currency: "eur",
                }),
            );

            const refreshed = await Subscription.findOne({
                userId: user._id,
            }).lean();

            expect(refreshed.status).toBe("active");
        });

        it("should report a missing payment method", async () => {
            mockStripe.invoices.retrieve.mockResolvedValue({
                id: "in_past_due",
                amount_due: 1999,
                currency: "eur",
                status: "open",
            });
            mockStripe.invoices.pay.mockRejectedValue(new Error("no pm"));

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Trial ended, but no valid payment method found. Please add a payment method.",
            );
            expect(response.body.data.action).toBe("payment_method_required");
            expect(response.body.data.paymentIssue.reason).toBe(
                "no_payment_method",
            );
        });

        it("should report a failed payment", async () => {
            mockStripe.invoices.retrieve.mockResolvedValue({
                id: "in_past_due",
                amount_due: 1999,
                currency: "eur",
                status: "open",
                payment_intent: {
                    id: "pi_failed",
                    status: "failed",
                    last_payment_error: { code: "card_declined" },
                },
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Trial ended, but payment failed. Please update your payment method.",
            );
            expect(response.body.data.action).toBe("payment_failed");
            expect(response.body.data.paymentIssue.lastError).toEqual({
                code: "card_declined",
            });
        });

        it("should report an unexpected payment status", async () => {
            mockStripe.invoices.retrieve.mockResolvedValue({
                id: "in_past_due",
                amount_due: 0,
                currency: "eur",
                status: "open",
                payment_intent: { id: "pi_weird", status: "processing" },
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Unexpected payment status: processing. Please contact support.",
            );
            expect(response.body.data.action).toBe("unexpected_payment_status");
            expect(response.body.data.debug.paymentIntentStatus).toBe(
                "processing",
            );
        });
    });

    describe("given the local subscription is past_due", () => {
        it("should report the failed payment without touching Stripe", async () => {
            await seedSubscription(user._id, { status: "past_due" });
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "past_due",
                latest_invoice: {
                    id: "in_1",
                    amount_due: 1999,
                    payment_intent: {
                        id: "pi_failed",
                        status: "failed",
                        last_payment_error: { code: "card_declined" },
                    },
                },
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Payment failed. Please update your payment method.",
            );
            expect(response.body.data.action).toBe("payment_failed");
            expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
        });

        it("should fall back to the unknown state for a succeeded payment", async () => {
            await seedSubscription(user._id, { status: "past_due" });
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "past_due",
                latest_invoice: {
                    id: "in_1",
                    status: "paid",
                    payment_intent: { id: "pi_ok", status: "succeeded" },
                },
            });

            const response = await endTrial();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Unknown state detected. Please contact support.",
            );
            expect(response.body.data.action).toBe("unknown");
            expect(response.body.data.debug).toEqual({
                subscriptionStatus: "past_due",
                paymentIntentStatus: "succeeded",
                invoiceStatus: "paid",
            });
        });

        it("should fall back to the unknown state with no invoice", async () => {
            await seedSubscription(user._id, { status: "past_due" });
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_trial",
                status: "past_due",
            });

            const response = await endTrial();

            expect(response.body.data.debug).toEqual({
                subscriptionStatus: "past_due",
                paymentIntentStatus: "none",
                invoiceStatus: "none",
            });
            expect(response.body.data.nextStep).toBe(
                "Contact support with this requestId",
            );
        });
    });
});
