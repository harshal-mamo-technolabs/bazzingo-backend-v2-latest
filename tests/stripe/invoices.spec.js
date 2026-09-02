const request = require("supertest");
const express = require("express");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const Order = require("../../src/modules/stripe/orderModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

const mockStripe = {
    invoices: { list: jest.fn() },
    charges: { list: jest.fn() },
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

const seedOrder = (userId, overrides = {}) =>
    Order.create({
        userId,
        status: "succeeded",
        productName: "iq-test",
        unitAmount: 1000,
        currency: "EUR",
        stripePaymentIntentId: `pi_${Math.random().toString(36).slice(2)}`,
        ...overrides,
    });

describe("GET /stripe/invoices", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        jest.clearAllMocks();
        mockStripe.invoices.list.mockResolvedValue({ data: [] });
        mockStripe.charges.list.mockResolvedValue({ data: [] });
        user = await createUser({ stripeCustomerId: "cus_1" });
        token = getAccessToken(user._id);
    });

    it("rejects an unauthenticated request", async () => {
        const res = await request(app).get("/stripe/invoices");

        expect(res.status).toBe(401);
    });

    it("returns an empty list when the user has no stripe customer", async () => {
        const noCustomerUser = await createUser({
            email: "no-customer@bazzingo.com",
            stripeCustomerId: null,
        });
        const noCustomerToken = getAccessToken(noCustomerUser._id);

        const res = await request(app)
            .get("/stripe/invoices")
            .set("Authorization", `Bearer ${noCustomerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.invoices).toEqual([]);
        expect(mockStripe.charges.list).not.toHaveBeenCalled();
    });

    it("lists a one-time purchase whose payment intent has a single successful charge", async () => {
        const order = await seedOrder(user._id, {
            stripePaymentIntentId: "pi_clean",
            productName: "logic",
        });

        mockStripe.charges.list.mockResolvedValue({
            data: [
                {
                    payment_intent: "pi_clean",
                    status: "succeeded",
                    receipt_url: "https://pay.stripe.com/receipts/clean",
                    amount: 1000,
                    currency: "eur",
                },
            ],
        });

        const res = await request(app)
            .get("/stripe/invoices")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.invoices).toEqual([
            expect.objectContaining({
                id: String(order._id),
                description: "logic",
                status: "paid",
                invoicePdf: "https://pay.stripe.com/receipts/clean",
            }),
        ]);
    });

    // Regression: a payment intent can carry a failed attempt before it
    // eventually succeeds (declined card retried, 3DS retry, etc). Stripe's
    // charges.list returns charges newest-first, so the failed (older)
    // attempt lands *after* the successful one in the array for that intent.
    // Naively keying a Map off payment_intent let that later, failed charge
    // overwrite the successful one — which zeroed out the receipt url and
    // silently dropped the whole purchase from the response.
    it("still lists the purchase when its payment intent also has an earlier failed charge attempt", async () => {
        const order = await seedOrder(user._id, {
            stripePaymentIntentId: "pi_retried",
            productName: "iq-test",
        });

        mockStripe.charges.list.mockResolvedValue({
            data: [
                // Newest first: the eventual success...
                {
                    payment_intent: "pi_retried",
                    status: "succeeded",
                    receipt_url: "https://pay.stripe.com/receipts/success",
                    amount: 1000,
                    currency: "eur",
                },
                // ...then the older, failed first attempt on the same intent.
                {
                    payment_intent: "pi_retried",
                    status: "failed",
                    receipt_url: null,
                    amount: 1000,
                    currency: "eur",
                },
            ],
        });

        const res = await request(app)
            .get("/stripe/invoices")
            .set("Authorization", `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.invoices).toEqual([
            expect.objectContaining({
                id: String(order._id),
                description: "iq-test",
                status: "paid",
                invoicePdf: "https://pay.stripe.com/receipts/success",
            }),
        ]);
    });
});
