const request = require("supertest");
const express = require("express");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const { config } = require("../../src/config");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const stripeElementsRouter = require("../../src/modules/stripe-elements/stripeElementsRouter");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/stripe-elements", stripeElementsRouter);
    app.use(globalErrorHandler);

    return app;
};

describe("stripe elements configuration endpoints", () => {
    useInMemoryDatabase();

    let app;
    let originalConfig;

    beforeEach(() => {
        app = buildApp();
        originalConfig = {
            STRIPE_PUBLIC_KEY: config.STRIPE_PUBLIC_KEY,
            STRIPE_ELEMENTS_PRICE_ID: config.STRIPE_ELEMENTS_PRICE_ID,
            STRIPE_ELEMENTS_TRIAL_PRICE_ID:
                config.STRIPE_ELEMENTS_TRIAL_PRICE_ID,
            STRIPE_ELEMENTS_TRIAL_DAYS: config.STRIPE_ELEMENTS_TRIAL_DAYS,
        };
    });

    afterEach(() => {
        Object.assign(config, originalConfig);
    });

    describe("GET /stripe-elements/config", () => {
        it("returns the publishable key without authentication", async () => {
            config.STRIPE_PUBLIC_KEY = "pk_test_123";

            const res = await request(app).get("/stripe-elements/config");

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                status: "success",
                message: "Stripe configuration retrieved",
                data: { publishableKey: "pk_test_123" },
            });
        });

        it("returns a null publishable key when it is not configured", async () => {
            config.STRIPE_PUBLIC_KEY = "";

            const res = await request(app).get("/stripe-elements/config");

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ publishableKey: null });
        });
    });

    describe("GET /stripe-elements/default-config", () => {
        it("returns the configured default values", async () => {
            config.STRIPE_ELEMENTS_PRICE_ID = "price_recurring";
            config.STRIPE_ELEMENTS_TRIAL_PRICE_ID = "price_trial";
            config.STRIPE_ELEMENTS_TRIAL_DAYS = "7";

            const res = await request(app).get(
                "/stripe-elements/default-config",
            );

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                status: "success",
                message: "Default configuration values retrieved",
                data: {
                    recurringPriceId: "price_recurring",
                    trialPriceId: "price_trial",
                    trialDays: 7,
                    env: {
                        STRIPE_ELEMENTS_PRICE_ID: "price_recurring",
                        STRIPE_ELEMENTS_TRIAL_PRICE_ID: "price_trial",
                        STRIPE_ELEMENTS_TRIAL_DAYS: "7",
                    },
                },
            });
        });

        it("falls back to nulls and a three day trial when nothing is configured", async () => {
            config.STRIPE_ELEMENTS_PRICE_ID = "";
            config.STRIPE_ELEMENTS_TRIAL_PRICE_ID = "";
            config.STRIPE_ELEMENTS_TRIAL_DAYS = "";

            const res = await request(app).get(
                "/stripe-elements/default-config",
            );

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({
                recurringPriceId: null,
                trialPriceId: null,
                trialDays: 3,
                env: {
                    STRIPE_ELEMENTS_PRICE_ID: null,
                    STRIPE_ELEMENTS_TRIAL_PRICE_ID: null,
                    STRIPE_ELEMENTS_TRIAL_DAYS: null,
                },
            });
        });
    });

    describe("when the stripe client is not configured", () => {
        let token;

        beforeEach(async () => {
            const user = await createUser();
            token = getAccessToken(user._id);
        });

        it.each([
            ["post", "/stripe-elements/create-subscription"],
            ["post", "/stripe-elements/activate-subscription"],
            ["get", "/stripe-elements/subscription-status/sub_1"],
            ["post", "/stripe-elements/confirm-subscription"],
            ["post", "/stripe-elements/cancel-subscription"],
            ["get", "/stripe-elements/my-subscriptions"],
            ["post", "/stripe-elements/create-payment"],
            ["get", "/stripe-elements/payment-status/order-1"],
            ["post", "/stripe-elements/confirm-payment"],
            ["post", "/stripe-elements/quick-pay"],
            ["post", "/stripe-elements/pay"],
        ])("fails %s %s with a server error", async (method, path) => {
            const res = await request(app)
                [method](path)
                .set("Authorization", `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(500);
            expect(res.body.status).toBe("error");
        });

        it("still lists orders because they do not need stripe", async () => {
            const res = await request(app)
                .get("/stripe-elements/my-orders")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ orders: [], total: 0 });
        });
    });
});
