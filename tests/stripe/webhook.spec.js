const request = require("supertest");
const express = require("express");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const logger = require("../../src/config/logger");
const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const Plan = require("../../src/modules/plan/planModel");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const Order = require("../../src/modules/stripe/orderModel");
const Subscription = require("../../src/modules/stripe/subscriptionModel");
const User = require("../../src/modules/user/userModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");

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

jest.mock("../../src/config", () => {
    const actual = jest.requireActual("../../src/config");

    return {
        ...actual,
        config: { ...actual.config, STRIPE_WEBHOOK_KEY: "whsec_test" },
    };
});

const mockSendEmail = jest.fn().mockResolvedValue(undefined);

jest.mock("../../src/common/utils/email", () => ({
    sendEmail: (...args) => mockSendEmail(...args),
}));

const stripeWebhookRouter = require("../../src/modules/stripe/stripeWebhookRouter");
const {
    StripeWebhookController,
} = require("../../src/modules/stripe/stripeWebhookController");
const { StripeService } = require("../../src/modules/stripe/stripeService");

const buildApp = () => {
    const app = express();

    app.use(requestLogger);
    app.use("/stripe/webhook", stripeWebhookRouter);
    app.use(express.json());
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const post = (body) =>
    request(app)
        .post("/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "sig_test")
        .send(JSON.stringify(body));

const givenEvent = (type, object) => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
        type,
        data: { object },
    });

    return post({ type });
};

const seedAssessment = () =>
    FullAssessment.create({
        mainCategory: "iq-test",
        questions: 20,
        subcategories: ["logic"],
        stripeProductId: "prod_assessment",
    });

const seedSubscription = (userId, overrides = {}) =>
    Subscription.create({
        userId,
        stripeSubscriptionId: "sub_hook",
        status: "trialing",
        planDuration: "monthly",
        currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
        ...overrides,
    });

describe("POST /stripe/webhook", () => {
    useInMemoryDatabase();

    let user;

    beforeEach(async () => {
        jest.clearAllMocks();
        user = await createUser();
        mockStripe.invoices.list.mockResolvedValue({ data: [] });
    });

    describe("given the signature is valid", () => {
        it("should return a 200 status code with the v1 body", async () => {
            const response = await givenEvent("ping.unhandled", {});

            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual({ received: true });
        });

        it("should verify against the raw request body", async () => {
            await givenEvent("ping.unhandled", {});

            const [payload, signature, secret] =
                mockStripe.webhooks.constructEvent.mock.calls[0];

            expect(Buffer.isBuffer(payload)).toBe(true);
            expect(JSON.parse(payload.toString())).toEqual({
                type: "ping.unhandled",
            });
            expect(signature).toBe("sig_test");
            expect(secret).toBe("whsec_test");
        });
    });

    describe("given the signature is invalid", () => {
        it("should return a 400 status code with the Stripe error", async () => {
            mockStripe.webhooks.constructEvent.mockImplementation(() => {
                throw new Error("No signatures found matching the payload");
            });

            const response = await post({ type: "ping" });

            expect(response.statusCode).toBe(400);
            expect(response.text).toBe(
                "Webhook Error: No signatures found matching the payload",
            );
        });
    });

    describe("given the webhook is not configured", () => {
        const buildControllerApp = (controller) => {
            const stub = express();

            stub.use(express.raw({ type: "application/json" }));
            stub.post("/stripe/webhook", (req, res, next) =>
                controller.webhook(req, res, next),
            );

            return stub;
        };

        it("should return a 500 status code when the secret is missing", async () => {
            const controller = new StripeWebhookController(
                new StripeService(logger, mockStripe),
                logger,
                mockStripe,
                "",
            );

            const response = await request(buildControllerApp(controller))
                .post("/stripe/webhook")
                .set("Content-Type", "application/json")
                .send(JSON.stringify({ type: "ping" }));

            expect(response.statusCode).toBe(500);
            expect(response.text).toBe("Webhook secret not configured");
        });

        it("should return a 500 status code when Stripe is missing", async () => {
            const controller = new StripeWebhookController(
                new StripeService(logger, null),
                logger,
                null,
                "whsec_test",
            );

            const response = await request(buildControllerApp(controller))
                .post("/stripe/webhook")
                .set("Content-Type", "application/json")
                .send(JSON.stringify({ type: "ping" }));

            expect(response.statusCode).toBe(500);
            expect(response.text).toBe("Stripe not configured");
        });

        it("should return a 400 status code when there is no payload", async () => {
            const controller = new StripeWebhookController(
                new StripeService(logger, mockStripe),
                logger,
                mockStripe,
                "whsec_test",
            );
            const stub = express();

            stub.post("/stripe/webhook", (req, res, next) =>
                controller.webhook(req, res, next),
            );

            const response = await request(stub).post("/stripe/webhook");

            expect(response.statusCode).toBe(400);
            expect(response.text).toBe(
                "Webhook Error: No webhook payload was provided",
            );
        });
    });

    describe("given a handler throws", () => {
        it("should return a 500 status code", async () => {
            const failingService = new StripeService(logger, mockStripe);

            failingService.handleTrialWillEnd = jest.fn(async () => {
                throw new Error("db exploded");
            });

            const controller = new StripeWebhookController(
                failingService,
                logger,
                mockStripe,
                "whsec_test",
                () => ({
                    type: "customer.subscription.trial_will_end",
                    data: { object: { id: "sub_hook" } },
                }),
            );
            const stub = express();

            stub.use(express.raw({ type: "application/json" }));
            stub.post("/stripe/webhook", (req, res, next) =>
                controller.webhook(req, res, next),
            );

            const response = await request(stub)
                .post("/stripe/webhook")
                .set("Content-Type", "application/json")
                .send(JSON.stringify({ type: "x" }));

            expect(response.statusCode).toBe(500);
            expect(response.text).toBe("Webhook handler failed");
        });
    });

    describe("checkout.session.completed", () => {
        it("should mark the order as succeeded and save the payment method", async () => {
            const assessment = await seedAssessment();
            const order = await Order.create({
                userId: user._id,
                assessmentId: assessment._id,
                stripeSessionId: "cs_done",
                status: "requires_payment_method",
            });
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_done",
                payment_method: "pm_done",
            });

            const response = await givenEvent("checkout.session.completed", {
                id: "cs_done",
                payment_intent: "pi_done",
                customer: "cus_done",
                created: 1893456000,
            });

            expect(response.statusCode).toBe(200);

            const refreshedOrder = await Order.findById(order._id).lean();
            const refreshedUser = await User.findById(user._id).lean();

            expect(refreshedOrder.status).toBe("succeeded");
            expect(refreshedOrder.stripePaymentIntentId).toBe("pi_done");
            expect(refreshedOrder.stripeCustomerId).toBe("cus_done");
            expect(refreshedUser.stripeCustomerId).toBe("cus_done");
            expect(refreshedUser.defaultPaymentMethodId).toBe("pm_done");
            expect(mockStripe.customers.update).toHaveBeenCalledWith(
                "cus_done",
                { invoice_settings: { default_payment_method: "pm_done" } },
            );
        });

        it("should ignore an unknown session", async () => {
            const response = await givenEvent("checkout.session.completed", {
                id: "cs_unknown",
            });

            expect(response.statusCode).toBe(200);
            expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
        });
    });

    describe("payment_intent.succeeded", () => {
        it("should mark the order as succeeded", async () => {
            const order = await Order.create({
                userId: user._id,
                stripePaymentIntentId: "pi_ok",
                status: "processing",
            });

            const response = await givenEvent("payment_intent.succeeded", {
                id: "pi_ok",
                customer: "cus_ok",
                payment_method: { id: "pm_ok" },
                created: 1893456000,
            });

            expect(response.statusCode).toBe(200);

            const refreshedOrder = await Order.findById(order._id).lean();
            const refreshedUser = await User.findById(user._id).lean();

            expect(refreshedOrder.status).toBe("succeeded");
            expect(refreshedUser.defaultPaymentMethodId).toBe("pm_ok");
        });
    });

    describe("payment_intent.payment_failed", () => {
        it("should mark the order as failed", async () => {
            const order = await Order.create({
                userId: user._id,
                stripePaymentIntentId: "pi_bad",
                status: "processing",
            });

            await givenEvent("payment_intent.payment_failed", { id: "pi_bad" });

            const refreshed = await Order.findById(order._id).lean();

            expect(refreshed.status).toBe("failed");
        });
    });

    describe("checkout.session.async_payment_succeeded", () => {
        it("should mark the order as succeeded", async () => {
            const order = await Order.create({
                userId: user._id,
                stripeSessionId: "cs_async",
                status: "processing",
            });

            await givenEvent("checkout.session.async_payment_succeeded", {
                id: "cs_async",
                payment_intent: "pi_async",
                customer: "cus_async",
                created: 1893456000,
            });

            const refreshed = await Order.findById(order._id).lean();

            expect(refreshed.status).toBe("succeeded");
            expect(refreshed.stripePaymentIntentId).toBe("pi_async");
        });
    });

    describe("checkout.session.async_payment_failed", () => {
        it("should mark the order as failed", async () => {
            const order = await Order.create({
                userId: user._id,
                stripeSessionId: "cs_async_bad",
                status: "processing",
            });

            await givenEvent("checkout.session.async_payment_failed", {
                id: "cs_async_bad",
            });

            const refreshed = await Order.findById(order._id).lean();

            expect(refreshed.status).toBe("failed");
        });
    });

    describe("checkout.session.expired", () => {
        it("should mark the order as canceled", async () => {
            const order = await Order.create({
                userId: user._id,
                stripeSessionId: "cs_expired",
                status: "requires_payment_method",
            });

            await givenEvent("checkout.session.expired", {
                id: "cs_expired",
            });

            const refreshed = await Order.findById(order._id).lean();

            expect(refreshed.status).toBe("canceled");
        });
    });

    describe("customer.subscription.created", () => {
        const seedPlanAndPrice = async () => {
            const plan = await Plan.create({
                name: "Pro",
                stripeProductId: "prod_plan",
            });
            const price = await PriceCatalog.create({
                planId: plan._id,
                stripePriceId: "price_monthly",
                stripeProductId: "prod_plan",
                type: "recurring",
                currency: "EUR",
                unitAmount: 1999,
                productDuration: "monthly",
            });

            return { plan, price };
        };

        it("should create the subscription row", async () => {
            const { plan, price } = await seedPlanAndPrice();

            const response = await givenEvent("customer.subscription.created", {
                id: "sub_created",
                status: "trialing",
                customer: "cus_created",
                created: 1893456000,
                metadata: {
                    userId: user._id.toString(),
                    planId: plan._id.toString(),
                },
                items: {
                    data: [
                        {
                            price: { id: "price_monthly" },
                            plan: { interval: "month" },
                            current_period_start: 1893456000,
                            current_period_end: 1896134400,
                        },
                    ],
                },
                trial_start: 1893456000,
                trial_end: 1893715200,
            });

            expect(response.statusCode).toBe(200);

            const created = await Subscription.findOne({
                stripeSubscriptionId: "sub_created",
            }).lean();

            expect(created.userId.toString()).toBe(user._id.toString());
            expect(created.planId).toBe(plan._id.toString());
            expect(created.priceCatalogId.toString()).toBe(
                price._id.toString(),
            );
            expect(created.status).toBe("trialing");
            expect(created.planDuration).toBe("monthly");
            expect(created.trialEnd.toISOString()).toBe(
                new Date(1893715200 * 1000).toISOString(),
            );
        });

        it("should adopt the Stripe customer id on the user", async () => {
            const { plan } = await seedPlanAndPrice();

            await givenEvent("customer.subscription.created", {
                id: "sub_created",
                status: "active",
                customer: "cus_created",
                default_payment_method: "pm_sub",
                metadata: {
                    userId: user._id.toString(),
                    planId: plan._id.toString(),
                },
                items: {
                    data: [
                        {
                            price: { id: "price_monthly" },
                            plan: { interval: "month" },
                        },
                    ],
                },
            });

            const refreshed = await User.findById(user._id).lean();

            expect(refreshed.stripeCustomerId).toBe("cus_created");
            expect(refreshed.defaultPaymentMethodId).toBe("pm_sub");
        });

        it("should skip when the price catalog row is unknown", async () => {
            const plan = await Plan.create({
                name: "Pro",
                stripeProductId: "prod_plan",
            });

            const response = await givenEvent("customer.subscription.created", {
                id: "sub_orphan",
                status: "active",
                metadata: {
                    userId: user._id.toString(),
                    planId: plan._id.toString(),
                },
                items: { data: [{ price: { id: "price_missing" } }] },
            });

            expect(response.statusCode).toBe(200);
            expect(
                await Subscription.countDocuments({
                    stripeSubscriptionId: "sub_orphan",
                }),
            ).toBe(0);
        });

        it("should create an Elements flow row without a plan", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_elements",
            });

            const response = await givenEvent("customer.subscription.created", {
                id: "sub_elements",
                status: "trialing",
                customer: "cus_elements",
                metadata: { flow: "stripe_elements" },
                items: {
                    data: [
                        {
                            price: {
                                id: "price_missing",
                                recurring: { interval: "year" },
                            },
                        },
                    ],
                },
                current_period_start: 1893456000,
                current_period_end: 1896134400,
            });

            expect(response.statusCode).toBe(200);

            const created = await Subscription.findOne({
                stripeSubscriptionId: "sub_elements",
            }).lean();

            expect(created.isElementsFlow).toBe(false);
            expect(created.userId.toString()).toBe(user._id.toString());
            expect(created.planDuration).toBe("yearly");
        });

        it("should flag an Elements flow row with no matching user", async () => {
            await givenEvent("customer.subscription.created", {
                id: "sub_elements_anon",
                status: "trialing",
                customer: "cus_unknown",
                metadata: { flow: "stripe_elements_trial" },
                items: { data: [{ price: { id: "price_missing" } }] },
                current_period_start: 1893456000,
                current_period_end: 1896134400,
            });

            const created = await Subscription.findOne({
                stripeSubscriptionId: "sub_elements_anon",
            }).lean();

            expect(created.isElementsFlow).toBe(true);
            expect(created.userId).toBeUndefined();
        });

        it("should email a landing page user to set their password on their first subscription", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_elements",
                landingPageName: "lp1",
            });

            await givenEvent("customer.subscription.created", {
                id: "sub_elements_lp",
                status: "trialing",
                customer: "cus_elements",
                metadata: { flow: "stripe_elements_trial" },
                items: { data: [{ price: { id: "price_missing" } }] },
                current_period_start: 1893456000,
                current_period_end: 1896134400,
            });

            expect(mockSendEmail).toHaveBeenCalledTimes(1);
            const [sent] = mockSendEmail.mock.calls[0];

            expect(sent.email).toBe(user.email);
            expect(sent.html).toContain("Create Your Password");
        });

        it("should not email a returning user's second subscription", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_elements",
                landingPageName: "lp1",
            });
            await seedSubscription(user._id, {
                stripeSubscriptionId: "sub_elements_prior",
            });

            await givenEvent("customer.subscription.created", {
                id: "sub_elements_second",
                status: "trialing",
                customer: "cus_elements",
                metadata: { flow: "stripe_elements_trial" },
                items: { data: [{ price: { id: "price_missing" } }] },
                current_period_start: 1893456000,
                current_period_end: 1896134400,
            });

            expect(mockSendEmail).not.toHaveBeenCalled();
        });

        it("should not email a user without a landing page name", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_elements",
            });

            await givenEvent("customer.subscription.created", {
                id: "sub_elements_no_lp",
                status: "trialing",
                customer: "cus_elements",
                metadata: { flow: "stripe_elements_trial" },
                items: { data: [{ price: { id: "price_missing" } }] },
                current_period_start: 1893456000,
                current_period_end: 1896134400,
            });

            expect(mockSendEmail).not.toHaveBeenCalled();
        });
    });

    describe("customer.subscription.updated", () => {
        it("should refresh the row from Stripe", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_hook",
                status: "active",
                current_period_start: 1893456000,
                current_period_end: 1896134400,
                cancel_at_period_end: true,
                cancel_at: 1896134400,
                metadata: {
                    bazingo_cancel_reason: "Too expensive",
                    bazingo_stay_if_offered: '["discount"]',
                },
            });

            const response = await givenEvent("customer.subscription.updated", {
                id: "sub_hook",
                status: "active",
            });

            expect(response.statusCode).toBe(200);

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_hook",
            }).lean();

            expect(refreshed.status).toBe("active");
            expect(refreshed.cancelAtPeriodEnd).toBe(true);
            expect(refreshed.cancelReason).toBe("Too expensive");
            expect(refreshed.wouldHaveStayedIfOffered).toEqual(["discount"]);
            expect(refreshed.currentPeriodEnd.toISOString()).toBe(
                new Date(1896134400 * 1000).toISOString(),
            );
        });

        it("should ignore an unknown subscription", async () => {
            const response = await givenEvent("customer.subscription.updated", {
                id: "sub_unknown",
                status: "active",
            });

            expect(response.statusCode).toBe(200);
        });

        it("should update an Elements flow row", async () => {
            await Subscription.create({
                stripeSubscriptionId: "sub_elements",
                isElementsFlow: true,
                status: "trialing",
                planDuration: "monthly",
                currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
                currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
            });
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_elements",
            });
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_elements",
                status: "active",
                current_period_start: 1893456000,
                current_period_end: 1896134400,
                cancel_at_period_end: false,
                metadata: { flow: "stripe_elements" },
            });

            await givenEvent("customer.subscription.updated", {
                id: "sub_elements",
                customer: "cus_elements",
                metadata: { flow: "stripe_elements" },
            });

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_elements",
            }).lean();

            expect(refreshed.status).toBe("active");
            expect(refreshed.isElementsFlow).toBe(false);
            expect(refreshed.userId.toString()).toBe(user._id.toString());
            expect(refreshed.nextBillingDate.toISOString()).toBe(
                new Date(1896134400 * 1000).toISOString(),
            );
        });
    });

    describe("customer.subscription.deleted", () => {
        it("should cancel the row", async () => {
            await seedSubscription(user._id);

            const response = await givenEvent("customer.subscription.deleted", {
                id: "sub_hook",
                status: "canceled",
                metadata: {
                    bazingo_cancel_reason: "Not useful",
                    bazingo_stay_if_offered: "discount, pause",
                },
            });

            expect(response.statusCode).toBe(200);

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_hook",
            }).lean();

            expect(refreshed.status).toBe("canceled");
            expect(refreshed.cancelReason).toBe("Not useful");
            expect(refreshed.wouldHaveStayedIfOffered).toEqual([
                "discount",
                "pause",
            ]);
        });

        it("should cancel an Elements flow row", async () => {
            await Subscription.create({
                stripeSubscriptionId: "sub_elements",
                isElementsFlow: true,
                status: "active",
                planDuration: "monthly",
                currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
                currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
            });

            await givenEvent("customer.subscription.deleted", {
                id: "sub_elements",
                metadata: { flow: "stripe_elements_paid_trial_subscription" },
            });

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_elements",
            }).lean();

            expect(refreshed.status).toBe("canceled");
        });
    });

    describe("invoice.payment_succeeded", () => {
        it("should record the billing amount and the new period", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_hook",
                status: "active",
                current_period_start: 1893456000,
                current_period_end: 1896134400,
                cancel_at_period_end: false,
            });

            const response = await givenEvent("invoice.payment_succeeded", {
                id: "in_paid",
                subscription: "sub_hook",
                amount_paid: 1999,
                currency: "eur",
                created: 1893456000,
                billing_reason: "subscription_cycle",
                lines: {
                    data: [
                        {
                            period: { start: 1893456000, end: 1896134400 },
                        },
                    ],
                },
            });

            expect(response.statusCode).toBe(200);

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_hook",
            }).lean();

            expect(refreshed.billingAmounts).toHaveLength(1);
            expect(refreshed.billingAmounts[0].amount).toBe(19.99);
            expect(refreshed.billingAmounts[0].invoiceId).toBe("in_paid");
            expect(refreshed.status).toBe("active");
            expect(refreshed.nextBillingDate.toISOString()).toBe(
                new Date(1896134400 * 1000).toISOString(),
            );
        });

        it("should not record the same invoice twice", async () => {
            await seedSubscription(user._id, {
                billingAmounts: [
                    {
                        amount: 19.99,
                        currency: "eur",
                        date: new Date(1893456000 * 1000),
                        invoiceId: "in_paid",
                        billingReason: "subscription_cycle",
                    },
                ],
            });
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_hook",
                status: "active",
            });

            await givenEvent("invoice.payment_succeeded", {
                id: "in_paid",
                subscription: "sub_hook",
                amount_paid: 1999,
                currency: "eur",
                created: 1893456000,
            });

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_hook",
            }).lean();

            expect(refreshed.billingAmounts).toHaveLength(1);
        });

        it("should resolve the subscription from the invoice lines", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_hook",
                status: "active",
            });

            await givenEvent("invoice.payment_succeeded", {
                id: "in_lines",
                amount_paid: 999,
                currency: "eur",
                created: 1893456000,
                lines: { data: [{ subscription: "sub_hook" }] },
            });

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_hook",
            }).lean();

            expect(refreshed.billingAmounts).toHaveLength(1);
        });

        it("should skip when no subscription can be resolved", async () => {
            mockStripe.invoices.retrieve.mockResolvedValue({ id: "in_orphan" });

            const response = await givenEvent("invoice.payment_succeeded", {
                id: "in_orphan",
                amount_paid: 999,
                currency: "eur",
                created: 1893456000,
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe("invoice.payment_failed", () => {
        it("should sync the subscription status from Stripe", async () => {
            await seedSubscription(user._id);
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_hook",
                status: "past_due",
            });

            await givenEvent("invoice.payment_failed", {
                id: "in_failed",
                subscription: "sub_hook",
            });

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_hook",
            }).lean();

            expect(refreshed.status).toBe("past_due");
        });

        it("should ignore an invoice without a subscription", async () => {
            const response = await givenEvent("invoice.payment_failed", {
                id: "in_failed",
            });

            expect(response.statusCode).toBe(200);
            expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
        });
    });

    describe("customer.subscription.trial_will_end", () => {
        it("should return a 200 status code", async () => {
            await seedSubscription(user._id);

            const response = await givenEvent(
                "customer.subscription.trial_will_end",
                { id: "sub_hook", trial_end: 1893456000, status: "trialing" },
            );

            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual({ received: true });
        });
    });

    describe("payment_method.attached", () => {
        it("should store the payment method on the user", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_pm",
            });

            await givenEvent("payment_method.attached", {
                id: "pm_attached",
                customer: "cus_pm",
            });

            const refreshed = await User.findById(user._id).lean();

            expect(refreshed.defaultPaymentMethodId).toBe("pm_attached");
            expect(mockStripe.customers.update).toHaveBeenCalledWith("cus_pm", {
                invoice_settings: { default_payment_method: "pm_attached" },
            });
        });

        // Regression: attaching a second card (e.g. saving an extra,
        // non-default card from the payment methods list) must not silently
        // steal the default away from the card the user already picked.
        it("should not override an existing default payment method", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_pm2",
                defaultPaymentMethodId: "pm_existing_default",
            });

            await givenEvent("payment_method.attached", {
                id: "pm_new_second_card",
                customer: "cus_pm2",
            });

            const refreshed = await User.findById(user._id).lean();

            expect(refreshed.defaultPaymentMethodId).toBe(
                "pm_existing_default",
            );
            expect(mockStripe.customers.update).not.toHaveBeenCalled();
        });
    });

    describe("charge.refunded", () => {
        it("should record a negative billing amount for a subscription invoice", async () => {
            await seedSubscription(user._id);
            mockStripe.invoices.retrieve.mockResolvedValue({
                id: "in_refund",
                subscription: "sub_hook",
            });

            await givenEvent("charge.refunded", {
                id: "ch_1",
                invoice: "in_refund",
                amount_refunded: 500,
                currency: "eur",
            });

            const refreshed = await Subscription.findOne({
                stripeSubscriptionId: "sub_hook",
            }).lean();

            expect(refreshed.billingAmounts).toHaveLength(1);
            expect(refreshed.billingAmounts[0].amount).toBe(-5);
            expect(refreshed.billingAmounts[0].billingReason).toBe("refund");
        });

        it("should refund the order when there is no invoice", async () => {
            const order = await Order.create({
                userId: user._id,
                stripePaymentIntentId: "pi_refund",
                status: "succeeded",
            });

            await givenEvent("charge.refunded", {
                id: "ch_2",
                payment_intent: "pi_refund",
                refunded: true,
                amount_refunded: 1999,
            });

            const refreshed = await Order.findById(order._id).lean();

            expect(refreshed.status).toBe("refunded");
            expect(refreshed.refundedAmount).toBe(19.99);
        });

        it("should mark a partial refund", async () => {
            const order = await Order.create({
                userId: user._id,
                stripePaymentIntentId: "pi_partial",
                status: "succeeded",
            });

            await givenEvent("charge.refunded", {
                id: "ch_3",
                payment_intent: "pi_partial",
                refunded: false,
                amount_refunded: 500,
            });

            const refreshed = await Order.findById(order._id).lean();

            expect(refreshed.status).toBe("partially_refunded");
            expect(refreshed.refundedAmount).toBe(5);
        });
    });

    describe("customer.deleted", () => {
        it("should clear the Stripe identifiers on the user", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_gone",
                defaultPaymentMethodId: "pm_gone",
            });

            await givenEvent("customer.deleted", { id: "cus_gone" });

            const refreshed = await User.findById(user._id).lean();

            expect(refreshed.stripeCustomerId).toBeNull();
            expect(refreshed.defaultPaymentMethodId).toBeNull();
        });
    });

    describe("acknowledged but unhandled events", () => {
        it.each([
            "refund.created",
            "refund.updated",
            "invoice.created",
            "invoice.finalized",
            "subscription_schedule.canceled",
        ])("should return a 200 status code for %s", async (type) => {
            const response = await givenEvent(type, { id: "obj_1" });

            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual({ received: true });
        });

        it("should return a 200 status code for invoice.paid", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_hook",
                metadata: { flow: "stripe_elements" },
            });

            const response = await givenEvent("invoice.paid", {
                id: "in_paid",
                subscription: "sub_hook",
            });

            expect(response.statusCode).toBe(200);
            expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                "sub_hook",
            );
        });
    });
});
