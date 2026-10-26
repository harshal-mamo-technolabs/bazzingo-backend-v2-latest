const request = require("supertest");
const express = require("express");

const mockStripe = {};

jest.mock("../../src/config/stripe", () => ({ getStripe: () => mockStripe }));

const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const { config } = require("../../src/config");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const User = require("../../src/modules/user/userModel");
const Subscription = require("../../src/modules/stripe/subscriptionModel");
const stripeElementsRouter = require("../../src/modules/stripe-elements/stripeElementsRouter");
const {
    KlaviyoSyncService,
} = require("../../src/modules/lp/klaviyoSyncService");

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
    mockStripe.prices = { retrieve: jest.fn() };
    mockStripe.customers = {
        create: jest.fn(),
        retrieve: jest.fn(),
        update: jest.fn(),
    };
    mockStripe.setupIntents = { create: jest.fn(), retrieve: jest.fn() };
    mockStripe.subscriptions = {
        create: jest.fn(),
        retrieve: jest.fn(),
        update: jest.fn(),
        cancel: jest.fn(),
        list: jest.fn(),
    };
    mockStripe.invoiceItems = { create: jest.fn() };
    mockStripe.invoices = { retrieve: jest.fn() };
    mockStripe.paymentIntents = {
        create: jest.fn(),
        retrieve: jest.fn(),
        list: jest.fn(),
        confirm: jest.fn(),
    };
};

const RECURRING_PRICE = {
    id: "price_rec",
    active: true,
    type: "recurring",
    unit_amount: 1999,
    currency: "eur",
    product: "prod_plan",
};

const TRIAL_PRICE = {
    id: "price_trial",
    active: true,
    type: "one_time",
    unit_amount: 100,
    currency: "eur",
    product: "prod_plan",
};

const SURVEY = {
    cancelReason: "Too expensive",
    wouldHaveStayedIfOffered: ["discount", "pause"],
};

describe("stripe elements subscription endpoints", () => {
    useInMemoryDatabase();

    let app;
    let user;
    let token;
    let originalPublicKey;

    beforeEach(async () => {
        resetStripe();
        app = buildApp();
        user = await createUser();
        token = getAccessToken(user._id);
        originalPublicKey = config.STRIPE_PUBLIC_KEY;
    });

    afterEach(() => {
        config.STRIPE_PUBLIC_KEY = originalPublicKey;
    });

    describe("POST /stripe-elements/create-subscription", () => {
        beforeEach(() => {
            mockStripe.prices.retrieve.mockImplementation(async (id) =>
                id === TRIAL_PRICE.id ? TRIAL_PRICE : RECURRING_PRICE,
            );
            mockStripe.customers.create.mockResolvedValue({ id: "cus_new" });
            mockStripe.setupIntents.create.mockResolvedValue({
                id: "seti_1",
                client_secret: "seti_1_secret",
            });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(401);
            expect(res.body.message).toBe("Authentication required");
        });

        it("requires a recurring price id", async () => {
            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "recurringPriceId is required. Provide it in request body or set STRIPE_ELEMENTS_PRICE_ID env variable.",
            );
        });

        it("requires a trial price id when withTrial is true", async () => {
            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    recurringPriceId: RECURRING_PRICE.id,
                    withTrial: true,
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "trialPriceId is required when withTrial is true. Provide it in request body or set STRIPE_ELEMENTS_TRIAL_PRICE_ID env variable.",
            );
        });

        it("rejects an inactive recurring price", async () => {
            mockStripe.prices.retrieve.mockResolvedValue({
                ...RECURRING_PRICE,
                active: false,
            });

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "The specified recurring price is not active",
            );
        });

        it("rejects a price that is not recurring", async () => {
            mockStripe.prices.retrieve.mockResolvedValue({
                ...RECURRING_PRICE,
                type: "one_time",
            });

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "The recurringPriceId must be a recurring price",
            );
        });

        it("rejects an inactive trial price", async () => {
            mockStripe.prices.retrieve.mockImplementation(async (id) =>
                id === TRIAL_PRICE.id
                    ? { ...TRIAL_PRICE, active: false }
                    : RECURRING_PRICE,
            );

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    recurringPriceId: RECURRING_PRICE.id,
                    withTrial: true,
                    trialPriceId: TRIAL_PRICE.id,
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "The specified trial price is not active",
            );
        });

        it("rejects a trial price that is not one time", async () => {
            mockStripe.prices.retrieve.mockImplementation(async (id) =>
                id === TRIAL_PRICE.id
                    ? { ...TRIAL_PRICE, type: "recurring" }
                    : RECURRING_PRICE,
            );

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    recurringPriceId: RECURRING_PRICE.id,
                    withTrial: true,
                    trialPriceId: TRIAL_PRICE.id,
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "The trialPriceId must be a one-time price",
            );
        });

        it("rejects a trial price from another product", async () => {
            mockStripe.prices.retrieve.mockImplementation(async (id) =>
                id === TRIAL_PRICE.id
                    ? { ...TRIAL_PRICE, product: "prod_other" }
                    : RECURRING_PRICE,
            );

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    recurringPriceId: RECURRING_PRICE.id,
                    withTrial: true,
                    trialPriceId: TRIAL_PRICE.id,
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "The trialPriceId must belong to the same product as the recurring price",
            );
        });

        it("creates a stripe customer and a setup intent", async () => {
            config.STRIPE_PUBLIC_KEY = "pk_test_1";

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("success");
            expect(res.body.message).toBe(
                "SetupIntent created. Collect card details and confirm, then call /activate-subscription.",
            );
            expect(res.body.data).toEqual({
                setupIntentId: "seti_1",
                clientSecret: "seti_1_secret",
                customerId: "cus_new",
                userId: String(user._id),
                recurringPriceId: RECURRING_PRICE.id,
                recurringAmount: 1999,
                currency: "eur",
                withTrial: false,
                trialPriceId: null,
                trialAmount: null,
                trialDays: null,
                immediateAmount: 1999,
                publishableKey: "pk_test_1",
                nextStep:
                    "After confirming SetupIntent, call POST /stripe-elements/activate-subscription with setupIntentId",
            });

            const saved = await User.findById(user._id).lean();
            expect(saved.stripeCustomerId).toBe("cus_new");

            expect(mockStripe.customers.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    email: user.email,
                    metadata: expect.objectContaining({
                        userId: String(user._id),
                        source: "stripe_elements_flow",
                    }),
                }),
            );
            expect(mockStripe.setupIntents.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    customer: "cus_new",
                    payment_method_types: ["card"],
                    usage: "off_session",
                }),
            );
        });

        it("accepts priceId as an alias of recurringPriceId", async () => {
            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ priceId: RECURRING_PRICE.id });

            expect(res.status).toBe(200);
            expect(res.body.data.recurringPriceId).toBe(RECURRING_PRICE.id);
        });

        it("reuses an existing stripe customer", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_existing",
            });
            mockStripe.customers.retrieve.mockResolvedValue({
                id: "cus_existing",
            });

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(200);
            expect(res.body.data.customerId).toBe("cus_existing");
            expect(mockStripe.customers.create).not.toHaveBeenCalled();
        });

        it("recreates the stripe customer when it is missing in stripe", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_gone",
            });
            mockStripe.customers.retrieve.mockRejectedValue(
                stripeError("No such customer", {
                    type: "StripeInvalidRequestError",
                    code: "resource_missing",
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(200);
            expect(res.body.data.customerId).toBe("cus_new");

            const saved = await User.findById(user._id).lean();
            expect(saved.stripeCustomerId).toBe("cus_new");
        });

        it("returns the trial pricing when withTrial is used", async () => {
            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    recurringPriceId: RECURRING_PRICE.id,
                    withTrial: true,
                    trialPriceId: TRIAL_PRICE.id,
                    trialDays: 5,
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe(
                "SetupIntent created. Trial fee will be charged immediately, then subscription starts after 5 days.",
            );
            expect(res.body.data).toMatchObject({
                withTrial: true,
                trialPriceId: TRIAL_PRICE.id,
                trialAmount: 100,
                trialDays: 5,
                immediateAmount: 100,
                recurringAmount: 1999,
            });
        });

        it("maps a missing stripe resource to a not found error", async () => {
            mockStripe.prices.retrieve.mockRejectedValue(
                stripeError("No such price: price_rec", {
                    type: "StripeInvalidRequestError",
                    code: "resource_missing",
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe(
                "Stripe resource not found: No such price: price_rec",
            );
        });

        it("maps an invalid stripe request to a bad request", async () => {
            mockStripe.setupIntents.create.mockRejectedValue(
                stripeError("Invalid customer", {
                    type: "StripeInvalidRequestError",
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("Invalid customer");
        });

        it("returns a server error when stripe fails unexpectedly", async () => {
            mockStripe.setupIntents.create.mockRejectedValue(
                new Error("stripe is down"),
            );

            const res = await request(app)
                .post("/stripe-elements/create-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ recurringPriceId: RECURRING_PRICE.id });

            expect(res.status).toBe(500);
            expect(res.body.message).toBe("Something went wrong");
        });
    });

    describe("POST /stripe-elements/activate-subscription", () => {
        const succeededSetupIntent = {
            id: "seti_1",
            status: "succeeded",
            payment_method: "pm_1",
            customer: "cus_1",
            metadata: { recurringPriceId: RECURRING_PRICE.id },
        };

        beforeEach(async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_1",
            });
            mockStripe.setupIntents.retrieve.mockResolvedValue(
                succeededSetupIntent,
            );
            mockStripe.customers.update.mockResolvedValue({ id: "cus_1" });
            mockStripe.prices.retrieve.mockResolvedValue(TRIAL_PRICE);
            mockStripe.invoiceItems.create.mockResolvedValue({ id: "ii_1" });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(401);
        });

        it("requires a setup intent id", async () => {
            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("setupIntentId is required");
        });

        it("rejects a setup intent that is not confirmed", async () => {
            mockStripe.setupIntents.retrieve.mockResolvedValue({
                ...succeededSetupIntent,
                status: "requires_payment_method",
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "SetupIntent is not confirmed. Status: requires_payment_method",
            );
        });

        it("rejects a setup intent that belongs to another customer", async () => {
            mockStripe.setupIntents.retrieve.mockResolvedValue({
                ...succeededSetupIntent,
                customer: "cus_other",
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe(
                "This SetupIntent does not belong to your account",
            );
        });

        it("rejects a setup intent without a payment method", async () => {
            mockStripe.setupIntents.retrieve.mockResolvedValue({
                ...succeededSetupIntent,
                payment_method: null,
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "No payment method found on SetupIntent",
            );
        });

        it("rejects a setup intent without a customer", async () => {
            await User.findByIdAndUpdate(user._id, {
                $unset: { stripeCustomerId: 1 },
            });
            mockStripe.setupIntents.retrieve.mockResolvedValue({
                ...succeededSetupIntent,
                customer: null,
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("No customer found on SetupIntent");
        });

        it("requires a recurring price id", async () => {
            mockStripe.setupIntents.retrieve.mockResolvedValue({
                ...succeededSetupIntent,
                metadata: {},
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("recurringPriceId is required");
        });

        it("creates an active subscription", async () => {
            await User.findByIdAndUpdate(user._id, {
                flowId: "OLD_FLOW",
                utmEmail: "old_email",
            });
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_1",
                status: "active",
                current_period_start: 1700000000,
                current_period_end: 1702592000,
                latest_invoice: {
                    id: "in_1",
                    payment_intent: {
                        id: "pi_1",
                        client_secret: "pi_1_secret",
                        status: "succeeded",
                    },
                },
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("success");
            expect(res.body.message).toBe("Subscription created successfully");
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                status: "active",
                customerId: "cus_1",
                recurringPriceId: RECURRING_PRICE.id,
                currentPeriodStart: new Date(1700000000 * 1000).toISOString(),
                currentPeriodEnd: new Date(1702592000 * 1000).toISOString(),
                requiresAction: false,
                paymentMethodId: "pm_1",
                withTrial: false,
            });

            expect(mockStripe.customers.update).toHaveBeenCalledWith("cus_1", {
                invoice_settings: { default_payment_method: "pm_1" },
            });

            const saved = await User.findById(user._id).lean();
            expect(saved.defaultPaymentMethodId).toBe("pm_1");
            const metadata =
                mockStripe.subscriptions.create.mock.calls[0][0].metadata;
            expect(metadata).not.toHaveProperty("flow_id");
            expect(metadata).not.toHaveProperty("utm_email");
        });

        it("bills the trial price on the first invoice of a trial subscription", async () => {
            await User.findByIdAndUpdate(user._id, {
                flowId: "OLD_FLOW",
                utmEmail: "old_email",
            });
            mockStripe.setupIntents.retrieve.mockResolvedValue({
                ...succeededSetupIntent,
                metadata: {
                    ...succeededSetupIntent.metadata,
                    flow_id: "XHLfvC",
                    utm_email: "Klaviyo",
                },
            });
            const trialEnd = 1702592000;
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_trial",
                status: "trialing",
                trial_end: trialEnd,
                latest_invoice: null,
            });
            mockStripe.paymentIntents.list.mockResolvedValue({ data: [] });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    setupIntentId: "seti_1",
                    withTrial: true,
                    trialPriceId: TRIAL_PRICE.id,
                    trialDays: 4,
                    flow_id: "DIFFERENT_FLOW",
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe(
                `Trial started! Subscription will begin on ${new Date(
                    trialEnd * 1000,
                ).toLocaleDateString()}`,
            );
            expect(res.body.data).toMatchObject({
                subscriptionId: "sub_trial",
                status: "trialing",
                withTrial: true,
                trialPriceId: TRIAL_PRICE.id,
                trialDays: 4,
                trialEnd: new Date(trialEnd * 1000).toISOString(),
            });

            expect(mockStripe.invoiceItems.create).not.toHaveBeenCalled();
            expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    customer: "cus_1",
                    add_invoice_items: [
                        {
                            price: TRIAL_PRICE.id,
                            metadata: expect.objectContaining({
                                type: "trial_fee",
                                trialPriceId: TRIAL_PRICE.id,
                            }),
                        },
                    ],
                    trial_period_days: 4,
                    metadata: expect.objectContaining({
                        flow_id: "XHLfvC",
                        flow: "stripe_elements_trial",
                    }),
                }),
            );
        });

        it("returns the client secret when the subscription is incomplete", async () => {
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_2",
                status: "incomplete",
                latest_invoice: { id: "in_2", payment_intent: "pi_2" },
            });
            mockStripe.paymentIntents.retrieve.mockResolvedValue({
                id: "pi_2",
                client_secret: "pi_2_secret",
                status: "requires_action",
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("requires_action");
            expect(res.body.message).toBe(
                "Subscription created. Please confirm the payment.",
            );
            expect(res.body.data).toEqual({
                subscriptionId: "sub_2",
                status: "incomplete",
                customerId: "cus_1",
                recurringPriceId: RECURRING_PRICE.id,
                requiresAction: true,
                clientSecret: "pi_2_secret",
                paymentIntentId: "pi_2",
                withTrial: false,
                paymentStatus: "requires_action",
                paymentMethodId: "pm_1",
            });
        });

        it("falls back to the invoice when the subscription has no payment intent", async () => {
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_3",
                status: "incomplete",
                latest_invoice: "in_3",
            });
            mockStripe.invoices.retrieve.mockResolvedValue({
                id: "in_3",
                status: "open",
                payment_intent: {
                    id: "pi_3",
                    client_secret: "pi_3_secret",
                    status: "requires_action",
                },
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(200);
            expect(mockStripe.invoices.retrieve).toHaveBeenCalledWith("in_3", {
                expand: ["payment_intent"],
            });
            expect(res.body.data.clientSecret).toBe("pi_3_secret");
        });

        it("confirms a pending payment intent found on the customer", async () => {
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_4",
                status: "incomplete",
                latest_invoice: null,
            });
            mockStripe.paymentIntents.list.mockResolvedValue({
                data: [
                    {
                        id: "pi_4",
                        status: "requires_payment_method",
                        amount: 1999,
                        created: 1700000000,
                    },
                ],
            });
            mockStripe.paymentIntents.confirm.mockResolvedValue({
                id: "pi_4",
                client_secret: "pi_4_secret",
                status: "requires_action",
            });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(200);
            expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith(
                "pi_4",
                { payment_method: "pm_1" },
            );
            expect(res.body.data.clientSecret).toBe("pi_4_secret");
        });

        it("takes the client secret from a 3d secure confirmation error", async () => {
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_5",
                status: "incomplete",
                latest_invoice: null,
            });
            mockStripe.paymentIntents.list.mockResolvedValue({
                data: [
                    {
                        id: "pi_5",
                        status: "requires_payment_method",
                        amount: 1999,
                        created: 1700000000,
                    },
                ],
            });
            mockStripe.paymentIntents.confirm.mockRejectedValue(
                Object.assign(new Error("authentication required"), {
                    payment_intent: {
                        id: "pi_5",
                        client_secret: "pi_5_secret",
                        status: "requires_action",
                    },
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(200);
            expect(res.body.data.clientSecret).toBe("pi_5_secret");
        });

        it("returns a pending fallback for any other subscription status", async () => {
            mockStripe.subscriptions.create.mockResolvedValue({
                id: "sub_6",
                status: "past_due",
                latest_invoice: null,
            });
            mockStripe.paymentIntents.list.mockResolvedValue({ data: [] });

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("pending");
            expect(res.body.message).toBe("Subscription status: past_due");
            expect(res.body.data).toEqual({
                subscriptionId: "sub_6",
                status: "past_due",
                customerId: "cus_1",
                recurringPriceId: RECURRING_PRICE.id,
                requiresAction: false,
                clientSecret: null,
                paymentIntentId: null,
                paymentMethodId: "pm_1",
                withTrial: false,
            });
        });

        it("maps an invalid stripe request to a bad request", async () => {
            mockStripe.subscriptions.create.mockRejectedValue(
                stripeError("Invalid price", {
                    type: "StripeInvalidRequestError",
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("Invalid price");
        });

        it("returns a server error when stripe fails unexpectedly", async () => {
            mockStripe.setupIntents.retrieve.mockRejectedValue(
                new Error("boom"),
            );

            const res = await request(app)
                .post("/stripe-elements/activate-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ setupIntentId: "seti_1" });

            expect(res.status).toBe(500);
        });
    });

    describe("GET /stripe-elements/subscription-status/:subscriptionId", () => {
        beforeEach(async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_1",
            });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app).get(
                "/stripe-elements/subscription-status/sub_1",
            );

            expect(res.status).toBe(401);
        });

        it("rejects an invalid subscription id format", async () => {
            const res = await request(app)
                .get("/stripe-elements/subscription-status/abc")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("Invalid subscriptionId format");
        });

        it("returns the subscription status", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "active",
                customer: "cus_1",
                current_period_start: 1700000000,
                current_period_end: 1702592000,
                cancel_at_period_end: false,
                latest_invoice: { payment_intent: { status: "succeeded" } },
                default_payment_method: { id: "pm_1" },
            });

            const res = await request(app)
                .get("/stripe-elements/subscription-status/sub_1")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Subscription status retrieved");
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                status: "active",
                customerId: "cus_1",
                currentPeriodStart: new Date(1700000000 * 1000).toISOString(),
                currentPeriodEnd: new Date(1702592000 * 1000).toISOString(),
                cancelAtPeriodEnd: false,
                paymentStatus: "succeeded",
                requiresAction: false,
                actionClientSecret: null,
                defaultPaymentMethod: "pm_1",
                withTrial: false,
                isInTrial: false,
            });
        });

        it("reports the trial window and a pending 3d secure action", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "trialing",
                customer: "cus_1",
                cancel_at_period_end: false,
                trial_start: 1700000000,
                trial_end: 1702592000,
                latest_invoice: {
                    payment_intent: {
                        status: "requires_action",
                        client_secret: "pi_secret",
                    },
                },
                default_payment_method: "pm_str",
            });

            const res = await request(app)
                .get("/stripe-elements/subscription-status/sub_1")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({
                requiresAction: true,
                actionClientSecret: "pi_secret",
                defaultPaymentMethod: "pm_str",
                withTrial: true,
                isInTrial: true,
                trialStart: new Date(1700000000 * 1000).toISOString(),
                trialEnd: new Date(1702592000 * 1000).toISOString(),
            });
        });

        it("returns a server error when the subscription belongs to somebody else", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "active",
                customer: "cus_other",
            });

            const res = await request(app)
                .get("/stripe-elements/subscription-status/sub_1")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(500);
        });

        it("returns not found when stripe has no such subscription", async () => {
            mockStripe.subscriptions.retrieve.mockRejectedValue(
                stripeError("No such subscription", {
                    type: "StripeInvalidRequestError",
                    code: "resource_missing",
                }),
            );

            const res = await request(app)
                .get("/stripe-elements/subscription-status/sub_1")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("Subscription not found");
        });

        it("returns a server error when stripe fails unexpectedly", async () => {
            mockStripe.subscriptions.retrieve.mockRejectedValue(
                new Error("boom"),
            );

            const res = await request(app)
                .get("/stripe-elements/subscription-status/sub_1")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(500);
        });
    });

    describe("POST /stripe-elements/confirm-subscription", () => {
        beforeEach(async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_1",
            });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(401);
        });

        it("requires a subscription id", async () => {
            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("subscriptionId is required");
        });

        it("confirms an active subscription", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "active",
                customer: "cus_1",
                current_period_end: 1702592000,
                latest_invoice: { payment_intent: { id: "pi_1" } },
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1", paymentIntentId: "pi_1" });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Subscription is active");
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                status: "active",
                customerId: "cus_1",
                currentPeriodEnd: new Date(1702592000 * 1000).toISOString(),
                paymentStatus: "succeeded",
            });
        });

        it("confirms a trialing subscription", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "trialing",
                customer: "cus_1",
                trial_end: 1702592000,
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Subscription is in trial period");
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                status: "trialing",
                customerId: "cus_1",
                trialEnd: new Date(1702592000 * 1000).toISOString(),
            });
        });

        it("reports that 3d secure is still required", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "incomplete",
                customer: "cus_1",
                latest_invoice: {
                    payment_intent: {
                        id: "pi_1",
                        status: "requires_action",
                        client_secret: "pi_1_secret",
                    },
                },
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("requires_action");
            expect(res.body.message).toBe(
                "3D Secure authentication still required",
            );
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                status: "incomplete",
                requiresAction: true,
                clientSecret: "pi_1_secret",
                paymentIntentId: "pi_1",
            });
        });

        it("reports a failed payment", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "incomplete",
                customer: "cus_1",
                latest_invoice: {
                    payment_intent: {
                        id: "pi_1",
                        status: "requires_payment_method",
                        last_payment_error: { message: "card declined" },
                    },
                },
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(400);
            expect(res.body.status).toBe("error");
            expect(res.body.message).toBe(
                "Payment method required or payment failed",
            );
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                status: "incomplete",
                paymentStatus: "requires_payment_method",
                lastError: "card declined",
            });
        });

        it("reports a processing payment", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "incomplete",
                customer: "cus_1",
                latest_invoice: {
                    payment_intent: { id: "pi_1", status: "processing" },
                },
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("processing");
            expect(res.body.message).toBe("Payment is still processing");
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                status: "incomplete",
                paymentStatus: "processing",
            });
        });

        it("returns a pending fallback for any other status", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "past_due",
                customer: "cus_1",
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("pending");
            expect(res.body.message).toBe("Subscription status: past_due");
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                status: "past_due",
                customerId: "cus_1",
                paymentStatus: "unknown",
            });
        });

        it("returns a server error when the subscription belongs to somebody else", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                status: "active",
                customer: "cus_other",
            });

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(500);
        });

        it("returns not found when stripe has no such subscription", async () => {
            mockStripe.subscriptions.retrieve.mockRejectedValue(
                stripeError("No such subscription", {
                    type: "StripeInvalidRequestError",
                    code: "resource_missing",
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("Subscription not found");
        });

        it("returns a server error when stripe fails unexpectedly", async () => {
            mockStripe.subscriptions.retrieve.mockRejectedValue(
                new Error("boom"),
            );

            const res = await request(app)
                .post("/stripe-elements/confirm-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1" });

            expect(res.status).toBe(500);
        });
    });

    describe("POST /stripe-elements/cancel-subscription", () => {
        beforeEach(async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_1",
            });
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                customer: "cus_1",
                metadata: { flow: "stripe_elements" },
            });
            mockStripe.subscriptions.update.mockResolvedValue({
                id: "sub_1",
                status: "active",
                cancel_at_period_end: true,
                cancel_at: 1702592000,
                current_period_end: 1702592000,
            });
            mockStripe.subscriptions.cancel.mockResolvedValue({
                id: "sub_1",
                status: "canceled",
                cancel_at_period_end: false,
                cancel_at: null,
                current_period_end: 1702592000,
            });
        });

        it("rejects an unauthenticated request", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .send({ subscriptionId: "sub_1", ...SURVEY });

            expect(res.status).toBe(401);
        });

        it("requires a subscription id", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ ...SURVEY });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("subscriptionId is required");
        });

        it("requires a cancel reason string", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1", cancelReason: 5 });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe("cancelReason must be a string");
        });

        it("requires a non empty cancel reason", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1", cancelReason: "   " });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "cancelReason must be a non-empty string",
            );
        });

        it("rejects an oversized cancel reason", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    subscriptionId: "sub_1",
                    cancelReason: "x".repeat(501),
                    wouldHaveStayedIfOffered: ["a"],
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "cancelReason must be at most 500 characters",
            );
        });

        it("requires a non empty wouldHaveStayedIfOffered array", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    subscriptionId: "sub_1",
                    cancelReason: "Too expensive",
                    wouldHaveStayedIfOffered: [],
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "wouldHaveStayedIfOffered must be a non-empty array of strings",
            );
        });

        it("rejects non string survey entries", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    subscriptionId: "sub_1",
                    cancelReason: "Too expensive",
                    wouldHaveStayedIfOffered: [1],
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "wouldHaveStayedIfOffered must contain only strings",
            );
        });

        it("rejects blank survey entries", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    subscriptionId: "sub_1",
                    cancelReason: "Too expensive",
                    wouldHaveStayedIfOffered: ["  "],
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "wouldHaveStayedIfOffered entries must not be empty",
            );
        });

        it("rejects a survey that is too large once serialized", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    subscriptionId: "sub_1",
                    cancelReason: "Too expensive",
                    wouldHaveStayedIfOffered: [
                        "y".repeat(300),
                        "z".repeat(300),
                    ],
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe(
                "wouldHaveStayedIfOffered is too large when stored (max 500 characters serialized)",
            );
        });

        it("cancels at the end of the billing period", async () => {
            await Subscription.create({
                userId: user._id,
                stripeSubscriptionId: "sub_1",
                status: "active",
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(),
            });

            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1", ...SURVEY });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe(
                "Subscription will be cancelled at the end of the billing period",
            );
            expect(res.body.data).toEqual({
                subscriptionId: "sub_1",
                cancelReason: "Too expensive",
                wouldHaveStayedIfOffered: ["discount", "pause"],
                status: "active",
                cancelAtPeriodEnd: true,
                cancelAt: new Date(1702592000 * 1000).toISOString(),
                currentPeriodEnd: new Date(1702592000 * 1000).toISOString(),
            });

            expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
                "sub_1",
                {
                    cancel_at_period_end: true,
                    metadata: {
                        flow: "stripe_elements",
                        bazingo_cancel_reason: "Too expensive",
                        bazingo_stay_if_offered: '["discount","pause"]',
                    },
                },
            );

            const saved = await Subscription.findOne({
                stripeSubscriptionId: "sub_1",
            }).lean();
            expect(saved.cancelReason).toBe("Too expensive");
            expect(saved.wouldHaveStayedIfOffered).toEqual([
                "discount",
                "pause",
            ]);
            expect(saved.cancelAtPeriodEnd).toBe(true);
        });

        it("cancels immediately when asked", async () => {
            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    subscriptionId: "sub_1",
                    cancelImmediately: true,
                    ...SURVEY,
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Subscription cancelled immediately");
            expect(res.body.data.status).toBe("canceled");
            expect(res.body.data.cancelAt).toBeNull();
            expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(
                "sub_1",
            );
        });

        it("rejects a subscription that belongs to somebody else", async () => {
            mockStripe.subscriptions.retrieve.mockResolvedValue({
                id: "sub_1",
                customer: "cus_other",
            });

            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1", ...SURVEY });

            expect(res.status).toBe(403);
            expect(res.body.message).toBe(
                "This subscription does not belong to your account",
            );
        });

        it("returns not found when stripe has no such subscription", async () => {
            mockStripe.subscriptions.retrieve.mockRejectedValue(
                stripeError("No such subscription", {
                    type: "StripeInvalidRequestError",
                    code: "resource_missing",
                }),
            );

            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1", ...SURVEY });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe("Subscription not found");
        });

        it("returns a server error when stripe fails unexpectedly", async () => {
            mockStripe.subscriptions.update.mockRejectedValue(
                new Error("boom"),
            );

            const res = await request(app)
                .post("/stripe-elements/cancel-subscription")
                .set("Authorization", `Bearer ${token}`)
                .send({ subscriptionId: "sub_1", ...SURVEY });

            expect(res.status).toBe(500);
        });

        describe("the Klaviyo subscription sync", () => {
            afterEach(() => {
                jest.restoreAllMocks();
            });

            it("syncs the cancelled subscription", async () => {
                const local = await Subscription.create({
                    userId: user._id,
                    stripeSubscriptionId: "sub_1",
                    status: "active",
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(),
                });
                const sync = jest
                    .spyOn(KlaviyoSyncService.prototype, "syncSubscription")
                    .mockResolvedValue({ ok: true });

                const res = await request(app)
                    .post("/stripe-elements/cancel-subscription")
                    .set("Authorization", `Bearer ${token}`)
                    .send({ subscriptionId: "sub_1", ...SURVEY });

                expect(res.status).toBe(200);
                expect(sync).toHaveBeenCalledTimes(1);
                expect(sync.mock.calls[0][0]).toMatchObject({
                    email: user.email,
                });
                expect(
                    String(sync.mock.calls[0][0].subscriptionRecord._id),
                ).toBe(String(local._id));
            });

            it("skips the sync when no local subscription exists", async () => {
                const sync = jest
                    .spyOn(KlaviyoSyncService.prototype, "syncSubscription")
                    .mockResolvedValue({ ok: true });

                const res = await request(app)
                    .post("/stripe-elements/cancel-subscription")
                    .set("Authorization", `Bearer ${token}`)
                    .send({ subscriptionId: "sub_1", ...SURVEY });

                expect(res.status).toBe(200);
                expect(sync).not.toHaveBeenCalled();
            });

            it("keeps the response intact when the sync throws", async () => {
                await Subscription.create({
                    userId: user._id,
                    stripeSubscriptionId: "sub_1",
                    status: "active",
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(),
                });
                jest.spyOn(
                    KlaviyoSyncService.prototype,
                    "syncSubscription",
                ).mockRejectedValue(new Error("klaviyo down"));

                const res = await request(app)
                    .post("/stripe-elements/cancel-subscription")
                    .set("Authorization", `Bearer ${token}`)
                    .send({ subscriptionId: "sub_1", ...SURVEY });

                expect(res.status).toBe(200);
                expect(res.body.message).toBe(
                    "Subscription will be cancelled at the end of the billing period",
                );
            });
        });
    });

    describe("GET /stripe-elements/my-subscriptions", () => {
        it("rejects an unauthenticated request", async () => {
            const res = await request(app).get(
                "/stripe-elements/my-subscriptions",
            );

            expect(res.status).toBe(401);
        });

        it("returns only the database subscriptions when there is no stripe customer", async () => {
            await Subscription.create({
                userId: user._id,
                stripeSubscriptionId: "sub_db",
                status: "active",
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(),
            });

            const res = await request(app)
                .get("/stripe-elements/my-subscriptions")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("User subscriptions retrieved");
            expect(res.body.data.userId).toBe(String(user._id));
            expect(res.body.data.stripeCustomerId).toBeNull();
            expect(res.body.data.dbSubscriptions).toHaveLength(1);
            expect(res.body.data.dbSubscriptions[0].userId).toBe(
                String(user._id),
            );
            expect(res.body.data.stripeSubscriptions).toEqual([]);
            expect(res.body.data.summary).toEqual({
                totalDbSubscriptions: 1,
                totalStripeSubscriptions: 0,
                activeSubscriptions: 0,
            });
            expect(mockStripe.subscriptions.list).not.toHaveBeenCalled();
        });

        it("merges the stripe subscriptions when the user has a customer", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_1",
            });
            mockStripe.subscriptions.list.mockResolvedValue({
                data: [
                    {
                        id: "sub_1",
                        status: "active",
                        current_period_start: 1700000000,
                        current_period_end: 1702592000,
                        cancel_at_period_end: false,
                        cancel_at: null,
                        trial_start: null,
                        trial_end: null,
                        items: {
                            data: [
                                {
                                    price: {
                                        id: "price_rec",
                                        unit_amount: 1999,
                                        currency: "eur",
                                        recurring: { interval: "month" },
                                    },
                                },
                            ],
                        },
                        default_payment_method: {
                            id: "pm_1",
                            card: {
                                brand: "visa",
                                last4: "4242",
                                exp_month: 4,
                                exp_year: 2030,
                            },
                        },
                        metadata: { flow: "stripe_elements" },
                    },
                ],
            });

            const res = await request(app)
                .get("/stripe-elements/my-subscriptions")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
                customer: "cus_1",
                limit: 100,
                expand: ["data.default_payment_method"],
            });
            expect(res.body.data.stripeSubscriptions).toEqual([
                {
                    subscriptionId: "sub_1",
                    status: "active",
                    currentPeriodStart: new Date(
                        1700000000 * 1000,
                    ).toISOString(),
                    currentPeriodEnd: new Date(1702592000 * 1000).toISOString(),
                    cancelAtPeriodEnd: false,
                    cancelAt: null,
                    trialStart: null,
                    trialEnd: null,
                    priceId: "price_rec",
                    amount: 1999,
                    currency: "eur",
                    interval: "month",
                    defaultPaymentMethod: {
                        id: "pm_1",
                        brand: "visa",
                        last4: "4242",
                        expMonth: 4,
                        expYear: 2030,
                    },
                    metadata: { flow: "stripe_elements" },
                },
            ]);
            expect(res.body.data.summary).toEqual({
                totalDbSubscriptions: 0,
                totalStripeSubscriptions: 1,
                activeSubscriptions: 1,
            });
        });

        it("returns a server error when stripe fails", async () => {
            await User.findByIdAndUpdate(user._id, {
                stripeCustomerId: "cus_1",
            });
            mockStripe.subscriptions.list.mockRejectedValue(new Error("boom"));

            const res = await request(app)
                .get("/stripe-elements/my-subscriptions")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(500);
        });
    });
});
