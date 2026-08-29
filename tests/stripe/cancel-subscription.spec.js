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
const {
    KlaviyoSyncService,
} = require("../../src/modules/lp/klaviyoSyncService");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/stripe", stripeRouter);
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const PERIOD_END = 1893456000;

const seedSubscription = (userId, overrides = {}) =>
    Subscription.create({
        userId,
        stripeSubscriptionId: "sub_cancel",
        status: "active",
        planDuration: "monthly",
        currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
        ...overrides,
    });

const validSurvey = {
    cancelReason: "  Too expensive  ",
    wouldHaveStayedIfOffered: ["discount", "discount", " pause "],
};

describe("POST /stripe/subscription/cancel", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        token = getAccessToken(user._id);
        mockStripe.subscriptions.retrieve.mockResolvedValue({
            id: "sub_cancel",
            metadata: { existing: "value" },
        });
        mockStripe.subscriptions.update.mockResolvedValue({
            id: "sub_cancel",
            current_period_end: PERIOD_END,
        });
        mockStripe.subscriptions.cancel.mockResolvedValue({
            id: "sub_cancel",
            status: "canceled",
        });
    });

    const cancel = (body, accessToken = token) =>
        request(app)
            .post("/stripe/subscription/cancel")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app)
                .post("/stripe/subscription/cancel")
                .send(validSurvey);

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given an invalid cancellation survey", () => {
        it("should return a 400 status code when cancelReason is missing", async () => {
            const response = await cancel({
                wouldHaveStayedIfOffered: ["discount"],
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("cancelReason must be a string");
        });

        it("should return a 400 status code when cancelReason is blank", async () => {
            const response = await cancel({
                cancelReason: "   ",
                wouldHaveStayedIfOffered: ["discount"],
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "cancelReason must be a non-empty string",
            );
        });

        it("should return a 400 status code when cancelReason is too long", async () => {
            const response = await cancel({
                cancelReason: "x".repeat(501),
                wouldHaveStayedIfOffered: ["discount"],
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "cancelReason must be at most 500 characters",
            );
        });

        it("should return a 400 status code when the survey answers are missing", async () => {
            const response = await cancel({ cancelReason: "Too expensive" });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "wouldHaveStayedIfOffered must be a non-empty array of strings",
            );
        });

        it("should return a 400 status code when the survey answers are empty", async () => {
            const response = await cancel({
                cancelReason: "Too expensive",
                wouldHaveStayedIfOffered: [],
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "wouldHaveStayedIfOffered must be a non-empty array of strings",
            );
        });

        it("should return a 400 status code for a non string answer", async () => {
            const response = await cancel({
                cancelReason: "Too expensive",
                wouldHaveStayedIfOffered: [1],
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "wouldHaveStayedIfOffered must contain only strings",
            );
        });

        it("should return a 400 status code for a blank answer", async () => {
            const response = await cancel({
                cancelReason: "Too expensive",
                wouldHaveStayedIfOffered: ["  "],
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "wouldHaveStayedIfOffered entries must not be empty",
            );
        });

        it("should return a 400 status code when the answers do not fit in Stripe metadata", async () => {
            const response = await cancel({
                cancelReason: "Too expensive",
                wouldHaveStayedIfOffered: [
                    "a".repeat(200),
                    "b".repeat(200),
                    "c".repeat(200),
                ],
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "wouldHaveStayedIfOffered is too large when stored (max 500 characters serialized)",
            );
        });
    });

    describe("given the user has no subscription", () => {
        it("should return a 404 status code", async () => {
            const response = await cancel(validSurvey);

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe("No active subscription found");
        });
    });

    describe("given the subscription is already canceled", () => {
        it("should return a 400 status code", async () => {
            await seedSubscription(user._id, { status: "canceled" });

            const response = await cancel(validSurvey);

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Subscription is already canceled",
            );
        });
    });

    describe("given a cancellation at the end of the period", () => {
        it("should return a 200 status code with the v1 body", async () => {
            const subscription = await seedSubscription(user._id);

            const response = await cancel(validSurvey);

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Subscription will be canceled at the end of the current period",
            );
            expect(response.body.data.subscription).toEqual({
                id: subscription._id.toString(),
                status: "active",
                cancelAtPeriodEnd: true,
                cancelAt: new Date(PERIOD_END * 1000).toISOString(),
                cancelReason: "Too expensive",
                wouldHaveStayedIfOffered: ["discount", "pause"],
            });
        });

        it("should merge the survey into the Stripe metadata", async () => {
            await seedSubscription(user._id);

            await cancel(validSurvey);

            expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
                "sub_cancel",
                {
                    cancel_at_period_end: true,
                    metadata: {
                        existing: "value",
                        bazingo_cancel_reason: "Too expensive",
                        bazingo_stay_if_offered: '["discount","pause"]',
                    },
                },
            );
            expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
        });

        it("should persist the survey on the subscription", async () => {
            const subscription = await seedSubscription(user._id);

            await cancel(validSurvey);

            const refreshed = await Subscription.findById(
                subscription._id,
            ).lean();

            expect(refreshed.cancelReason).toBe("Too expensive");
            expect(refreshed.wouldHaveStayedIfOffered).toEqual([
                "discount",
                "pause",
            ]);
            expect(refreshed.cancelAtPeriodEnd).toBe(true);
            expect(refreshed.status).toBe("active");
        });

        it("should leave cancelAt null when Stripe returns no period end", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.update.mockResolvedValue({
                id: "sub_cancel",
            });

            const response = await cancel(validSurvey);

            expect(response.body.data.subscription.cancelAt).toBeNull();
        });
    });

    describe("given an immediate cancellation", () => {
        it("should return a 200 status code and cancel in Stripe", async () => {
            await seedSubscription(user._id);

            const response = await cancel({
                ...validSurvey,
                cancelAtPeriodEnd: false,
            });

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Subscription has been canceled immediately",
            );
            expect(response.body.data.subscription.status).toBe("canceled");
            expect(response.body.data.subscription.cancelAtPeriodEnd).toBe(
                false,
            );
            expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(
                "sub_cancel",
            );
            expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
                "sub_cancel",
                {
                    metadata: {
                        existing: "value",
                        bazingo_cancel_reason: "Too expensive",
                        bazingo_stay_if_offered: '["discount","pause"]',
                    },
                },
            );
        });
    });

    describe("given Stripe rejects the cancellation", () => {
        it("should return a 500 status code", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockRejectedValue(
                new Error("stripe down"),
            );

            const response = await cancel(validSurvey);

            expect(response.statusCode).toBe(500);
        });
    });

    describe("given the Klaviyo subscription sync", () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        it("should sync the cancelled subscription", async () => {
            const subscription = await seedSubscription(user._id);
            const sync = jest
                .spyOn(KlaviyoSyncService.prototype, "syncSubscription")
                .mockResolvedValue({ ok: true });

            const response = await cancel(validSurvey);

            expect(response.statusCode).toBe(200);
            expect(sync).toHaveBeenCalledTimes(1);
            expect(sync.mock.calls[0][0]).toMatchObject({
                email: user.email,
            });
            expect(String(sync.mock.calls[0][0].userId)).toBe(String(user._id));
            expect(String(sync.mock.calls[0][0].subscriptionRecord._id)).toBe(
                String(subscription._id),
            );
        });

        it("should keep the response intact when the sync throws", async () => {
            await seedSubscription(user._id);
            jest.spyOn(
                KlaviyoSyncService.prototype,
                "syncSubscription",
            ).mockRejectedValue(new Error("klaviyo down"));

            const response = await cancel(validSurvey);

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe(
                "Subscription will be canceled at the end of the current period",
            );
        });
    });
});
