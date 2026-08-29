const mongoose = require("mongoose");
const logger = require("../../src/config/logger");
const { KLAVIYO_EVENTS } = require("../../src/constants");
const {
    AssessmentService,
} = require("../../src/modules/assessment/assessmentService");
const {
    LeaderboardService,
} = require("../../src/modules/leaderboard/leaderboardService");
const {
    KlaviyoSyncService,
} = require("../../src/modules/lp/klaviyoSyncService");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const Order = require("../../src/modules/stripe/orderModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");
const { createFullAssessment } = require("../utils/assessmentFixtures");

const klaviyoService = {
    upsertProfileByEmail: jest.fn(async () => ({ ok: true })),
    createEvent: jest.fn(async () => ({ ok: true })),
};

const stripe = { prices: { retrieve: jest.fn() } };

const buildService = (stripeClient = stripe) =>
    new KlaviyoSyncService(
        logger,
        klaviyoService,
        new AssessmentService(logger),
        new LeaderboardService(logger),
        stripeClient,
    );

const properties = () =>
    klaviyoService.upsertProfileByEmail.mock.calls[0][0].properties;

const event = () => klaviyoService.createEvent.mock.calls[0][0];

const PERIOD_START = 1893456000;
const PERIOD_END = 1896134400;

describe("syncSubscription", () => {
    useInMemoryDatabase();

    let user;

    beforeEach(async () => {
        jest.clearAllMocks();
        klaviyoService.upsertProfileByEmail.mockResolvedValue({ ok: true });
        klaviyoService.createEvent.mockResolvedValue({ ok: true });
        stripe.prices.retrieve.mockResolvedValue(undefined);
        user = await createUser({ name: "Harshal" });
    });

    const stripeSubscription = (overrides = {}) => ({
        id: "sub_1",
        status: "active",
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
        items: { data: [{ price: { id: "price_1" } }] },
        ...overrides,
    });

    it("should skip without an email", async () => {
        const result = await buildService().syncSubscription({
            userId: user._id,
            email: "   ",
            stripeSubscription: stripeSubscription(),
        });

        expect(result).toEqual({ skipped: true, reason: "email missing" });
        expect(klaviyoService.upsertProfileByEmail).not.toHaveBeenCalled();
    });

    it("should skip without a stripe subscription and a local record", async () => {
        const result = await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
        });

        expect(result).toEqual({
            skipped: true,
            reason: "stripeSubscription + subscriptionRecord missing",
        });
        expect(klaviyoService.upsertProfileByEmail).not.toHaveBeenCalled();
    });

    it("should upsert the profile with the subscription properties", async () => {
        stripe.prices.retrieve.mockResolvedValue({
            product: { name: "Pro Yearly" },
        });

        const result = await buildService().syncSubscription({
            userId: user._id,
            email: "  HARSHAL@bazzingo.com ",
            stripeSubscription: stripeSubscription({
                items: {
                    data: [
                        {
                            price: {
                                id: "price_1",
                                recurring: { interval: "year" },
                            },
                        },
                    ],
                },
                trial_start: PERIOD_START,
                trial_end: PERIOD_END,
            }),
            previousSubscriptionStatus: "active",
        });

        expect(result).toEqual({ ok: true });
        expect(
            klaviyoService.upsertProfileByEmail.mock.calls[0][0],
        ).toMatchObject({ email: "harshal@bazzingo.com", name: "Harshal" });
        expect(properties()).toMatchObject({
            "Current Plan name": "Pro Yearly",
            "Current Plan duration": "yearly",
            "Current Plan status": "active",
            "Monthly or Yearly": "yearly",
            "Stripe subscription id": "sub_1",
            "Plan start Date": new Date(PERIOD_START * 1000).toISOString(),
            "Plan end date": new Date(PERIOD_END * 1000).toISOString(),
            "Next billing date": new Date(PERIOD_END * 1000).toISOString(),
            "Trial period start date": new Date(
                PERIOD_START * 1000,
            ).toISOString(),
            "Trial period end date": new Date(PERIOD_END * 1000).toISOString(),
        });
        expect(stripe.prices.retrieve).toHaveBeenCalledWith("price_1", {
            expand: ["product"],
        });
    });

    it("should leave the plan name empty when Stripe rejects", async () => {
        stripe.prices.retrieve.mockRejectedValue(new Error("stripe down"));

        const result = await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            previousSubscriptionStatus: "active",
        });

        expect(result).toEqual({ ok: true });
        expect(properties()["Current Plan name"]).toBeUndefined();
    });

    it("should not call Stripe without a price id", async () => {
        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription({ items: undefined }),
            previousSubscriptionStatus: "active",
        });

        expect(stripe.prices.retrieve).not.toHaveBeenCalled();
        expect(properties()["Current Plan name"]).toBeUndefined();
    });

    it("should leave the plan name empty without a stripe client", async () => {
        await buildService(null).syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            previousSubscriptionStatus: "active",
        });

        expect(properties()["Current Plan name"]).toBeUndefined();
    });

    it.each([
        ["trialing", "trial"],
        ["active", "active"],
        ["past_due", "in_active"],
        ["unpaid", "in_active"],
        ["incomplete", "in_active"],
        ["canceled", "cancelled"],
        ["paused", "paused"],
    ])("should map the %s status to %s", async (status, mapped) => {
        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription({ status }),
            previousSubscriptionStatus: "active",
        });

        expect(properties()["Current Plan status"]).toBe(mapped);
    });

    it("should build the subscription from the local record", async () => {
        const result = await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            subscriptionRecord: {
                stripeSubscriptionId: "sub_local",
                status: "trialing",
                planDuration: "yearly",
                currentPeriodStart: new Date(PERIOD_START * 1000),
                currentPeriodEnd: new Date(PERIOD_END * 1000),
                trialStart: new Date(PERIOD_START * 1000),
                trialEnd: new Date(PERIOD_END * 1000),
            },
        });

        expect(result).toEqual({ ok: true });
        expect(properties()).toMatchObject({
            "Stripe subscription id": "sub_local",
            "Current Plan status": "trial",
            "Monthly or Yearly": "yearly",
            "Current Plan duration": "yearly",
            "Plan start Date": new Date(PERIOD_START * 1000).toISOString(),
            "Plan end date": new Date(PERIOD_END * 1000).toISOString(),
            "Trial period end date": new Date(PERIOD_END * 1000).toISOString(),
        });
        expect(stripe.prices.retrieve).not.toHaveBeenCalled();
    });

    it("should prefer the invoice line period over the subscription period", async () => {
        const lineStart = 1900000000;
        const lineEnd = 1910000000;

        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            invoice: {
                id: "in_1",
                lines: {
                    data: [{ period: { start: lineStart, end: lineEnd } }],
                },
            },
            previousSubscriptionStatus: "active",
        });

        expect(properties()).toMatchObject({
            "Plan start Date": new Date(lineStart * 1000).toISOString(),
            "Plan end date": new Date(lineEnd * 1000).toISOString(),
            "Next billing date": new Date(lineEnd * 1000).toISOString(),
        });
    });

    it("should use trial_end for the plan end and next billing date when the invoice line period is degenerate", async () => {
        const trialEnd = PERIOD_START + 3 * 24 * 60 * 60;

        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription({
                status: "trialing",
                current_period_start: PERIOD_START,
                current_period_end: PERIOD_START,
                trial_end: trialEnd,
            }),
            invoice: {
                id: "in_1",
                lines: {
                    data: [
                        { period: { start: PERIOD_START, end: PERIOD_START } },
                    ],
                },
            },
        });

        expect(properties()).toMatchObject({
            "Plan end date": new Date(trialEnd * 1000).toISOString(),
            "Next billing date": new Date(trialEnd * 1000).toISOString(),
        });
    });

    it("should fall back to the next billing date of the local record", async () => {
        const nextBillingDate = new Date("2027-03-01T00:00:00.000Z");

        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            subscriptionRecord: { nextBillingDate },
            previousSubscriptionStatus: "active",
        });

        expect(properties()["Next billing date"]).toBe(
            nextBillingDate.toISOString(),
        );
    });

    it("should carry the cancellation survey of the local record", async () => {
        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            subscriptionRecord: {
                cancelReason: "  Too expensive  ",
                wouldHaveStayedIfOffered: [" discount ", "pause", ""],
            },
            previousSubscriptionStatus: "active",
        });

        expect(properties()).toMatchObject({
            "bazingo-cancel reason": "Too expensive",
            "bazingo-would have you stayed if offered": "discount, pause",
        });
    });

    it("should merge the leaderboard ranks of the user", async () => {
        await Leaderboard.create({
            userId: user._id,
            gameGlobalRank: 3,
            assessmentCountryRank: 9,
        });

        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            previousSubscriptionStatus: "active",
        });

        expect(properties()).toMatchObject({
            gameGlobalRank: 3,
            assessmentCountryRank: 9,
        });
    });

    it("should fire the activation event when the subscription turns active", async () => {
        stripe.prices.retrieve.mockResolvedValue({ product: { name: "Pro" } });

        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            invoice: { id: "in_1", created: PERIOD_START },
            previousSubscriptionStatus: "trialing",
        });

        expect(event()).toMatchObject({
            email: user.email,
            metricName: KLAVIYO_EVENTS.SUBSCRIPTION_ACTIVATED,
            uniqueId: "in_1:SubscriptionActivated",
            timeISO: new Date(PERIOD_START * 1000).toISOString(),
        });
        expect(event().properties).toMatchObject({
            "Current Plan name": "Pro",
            "Stripe subscription id": "sub_1",
        });
    });

    it("should key the activation event on the subscription without an invoice", async () => {
        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            previousSubscriptionStatus: "trialing",
        });

        expect(event().uniqueId).toBe("sub_1:SubscriptionActivated");
    });

    it("should not fire the activation event when the subscription was already active", async () => {
        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription(),
            previousSubscriptionStatus: "active",
        });

        expect(klaviyoService.createEvent).not.toHaveBeenCalled();
    });

    it("should not fire the activation event when the subscription is not active", async () => {
        await buildService().syncSubscription({
            userId: user._id,
            email: user.email,
            stripeSubscription: stripeSubscription({ status: "past_due" }),
            previousSubscriptionStatus: "trialing",
        });

        expect(klaviyoService.createEvent).not.toHaveBeenCalled();
    });

    it("should not throw when the activation event fails", async () => {
        klaviyoService.createEvent.mockRejectedValue(new Error("klaviyo down"));

        await expect(
            buildService().syncSubscription({
                userId: user._id,
                email: user.email,
                stripeSubscription: stripeSubscription(),
                previousSubscriptionStatus: "trialing",
            }),
        ).resolves.toEqual({ ok: true });
    });
});

describe("syncAssessmentPurchase", () => {
    useInMemoryDatabase();

    let user;
    let assessment;

    const purchasedAtISO = "2026-05-01T00:00:00.000Z";

    beforeEach(async () => {
        jest.clearAllMocks();
        klaviyoService.upsertProfileByEmail.mockResolvedValue({ ok: true });
        klaviyoService.createEvent.mockResolvedValue({ ok: true });
        user = await createUser({ name: "Harshal" });
        assessment = await createFullAssessment();
    });

    const seedOrder = (overrides = {}) =>
        Order.create({
            userId: user._id,
            assessmentId: assessment._id,
            status: "succeeded",
            ...overrides,
        });

    it("should skip an order without an assessment", async () => {
        const result = await buildService().syncAssessmentPurchase({
            order: { _id: new mongoose.Types.ObjectId(), userId: user._id },
            purchasedAtISO,
        });

        expect(result).toEqual({
            skipped: true,
            reason: "missing order userId/assessmentId",
        });
        expect(klaviyoService.upsertProfileByEmail).not.toHaveBeenCalled();
    });

    it("should skip an order whose user is gone", async () => {
        const result = await buildService().syncAssessmentPurchase({
            order: {
                _id: new mongoose.Types.ObjectId(),
                userId: new mongoose.Types.ObjectId(),
                assessmentId: assessment._id,
            },
            purchasedAtISO,
        });

        expect(result).toEqual({
            skipped: true,
            reason: "email missing on user",
        });
    });

    it("should skip an order without a main category", async () => {
        const result = await buildService().syncAssessmentPurchase({
            order: {
                _id: new mongoose.Types.ObjectId(),
                userId: user._id,
                assessmentId: new mongoose.Types.ObjectId(),
            },
            purchasedAtISO,
        });

        expect(result).toEqual({
            skipped: true,
            reason: "mainCategory missing",
        });
    });

    it("should upsert the purchase totals and fire the event", async () => {
        const other = await createFullAssessment({ title: "Second IQ" });
        const order = await seedOrder();

        await seedOrder({ assessmentId: other._id });
        await seedOrder({ assessmentId: other._id, status: "failed" });

        const result = await buildService().syncAssessmentPurchase({
            order,
            purchasedAtISO,
        });

        expect(result).toEqual({ ok: true });
        expect(
            klaviyoService.upsertProfileByEmail.mock.calls[0][0],
        ).toMatchObject({ email: user.email, name: "Harshal" });
        expect(properties()).toMatchObject({
            "total purchased iq-test": 2,
            "Last Purchased Assessment Name": "IQ Test",
            "Last Purchased Assessment Date": purchasedAtISO,
            mainCategory: "iq-test",
        });
        expect(event()).toMatchObject({
            email: user.email,
            metricName: KLAVIYO_EVENTS.ASSESSMENT_PURCHASED,
            uniqueId: `${order._id}:AssessmentPurchased`,
            timeISO: purchasedAtISO,
        });
        expect(event().properties).toMatchObject({
            mainCategory: "iq-test",
            "Last Purchased Assessment Name": "IQ Test",
        });
    });

    it("should fall back to the main category as the assessment name", async () => {
        const untitled = await createFullAssessment({ title: undefined });
        const order = await seedOrder({ assessmentId: untitled._id });

        await buildService().syncAssessmentPurchase({ order, purchasedAtISO });

        expect(properties()["Last Purchased Assessment Name"]).toBe("iq-test");
    });

    it("should merge the leaderboard ranks of the user", async () => {
        await Leaderboard.create({
            userId: user._id,
            assessmentGlobalRank: 11,
        });
        const order = await seedOrder();

        await buildService().syncAssessmentPurchase({ order, purchasedAtISO });

        expect(properties()).toMatchObject({ assessmentGlobalRank: 11 });
    });

    it("should not throw when the purchase event fails", async () => {
        klaviyoService.createEvent.mockRejectedValue(new Error("klaviyo down"));
        const order = await seedOrder();

        await expect(
            buildService().syncAssessmentPurchase({ order, purchasedAtISO }),
        ).resolves.toEqual({ ok: true });
    });
});
