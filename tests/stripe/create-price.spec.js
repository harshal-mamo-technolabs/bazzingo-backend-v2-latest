const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const logger = require("../../src/config/logger");
const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const Plan = require("../../src/modules/plan/planModel");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createAdmin, createUser, getAdminToken } = require("../utils/fixtures");

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
const { StripeService } = require("../../src/modules/stripe/stripeService");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/stripe", stripeRouter);
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const seedAssessment = (overrides = {}) =>
    FullAssessment.create({
        mainCategory: "iq-test",
        title: "IQ Test",
        questions: 20,
        subcategories: ["logic"],
        stripeProductId: "prod_assessment",
        ...overrides,
    });

const seedPlan = (overrides = {}) =>
    Plan.create({
        name: "Pro",
        stripeProductId: "prod_plan",
        ...overrides,
    });

describe("POST /stripe/prices", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        jest.clearAllMocks();
        adminToken = getAdminToken((await createAdmin())._id);
        mockStripe.prices.create.mockResolvedValue({ id: "price_new" });
    });

    const createPrice = (body, token = adminToken) =>
        request(app)
            .post("/stripe/prices")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    describe("given no admin credentials", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app)
                .post("/stripe/prices")
                .send({ unitAmount: 100 });

            expect(response.statusCode).toBe(401);
            expect(mockStripe.prices.create).not.toHaveBeenCalled();
        });

        it("should return a 401 status code for a user token", async () => {
            const user = await createUser();
            const response = await createPrice(
                { unitAmount: 100 },
                getAdminToken(user._id),
            );

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given both assessmentId and planId", () => {
        it("should return a 400 status code", async () => {
            const response = await createPrice({
                assessmentId: new mongoose.Types.ObjectId().toString(),
                planId: new mongoose.Types.ObjectId().toString(),
                unitAmount: 100,
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Provide either assessmentId or planId (exclusively)",
            );
        });
    });

    describe("given neither assessmentId nor planId", () => {
        it("should return a 400 status code", async () => {
            const response = await createPrice({ unitAmount: 100 });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Provide either assessmentId or planId (exclusively)",
            );
        });
    });

    describe("given an invalid unitAmount", () => {
        it("should return a 400 status code when it is not a number", async () => {
            const assessment = await seedAssessment();
            const response = await createPrice({
                assessmentId: assessment._id.toString(),
                unitAmount: "100",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "unitAmount must be a non-negative number (in smallest currency unit)",
            );
        });

        it("should return a 400 status code when it is negative", async () => {
            const assessment = await seedAssessment();
            const response = await createPrice({
                assessmentId: assessment._id.toString(),
                unitAmount: -1,
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "unitAmount must be a non-negative number (in smallest currency unit)",
            );
        });
    });

    describe("given an assessment that does not exist", () => {
        it("should return a 404 status code", async () => {
            const response = await createPrice({
                assessmentId: new mongoose.Types.ObjectId().toString(),
                unitAmount: 100,
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe("Assessment not found");
        });
    });

    describe("given an assessment without a Stripe product", () => {
        it("should return a 400 status code", async () => {
            const { insertedId } = await FullAssessment.collection.insertOne({
                mainCategory: "iq-test",
                questions: 20,
                subcategories: ["logic"],
            });

            const response = await createPrice({
                assessmentId: insertedId.toString(),
                unitAmount: 100,
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Assessment has no Stripe product ID",
            );
        });
    });

    describe("given a plan that does not exist", () => {
        it("should return a 404 status code", async () => {
            const response = await createPrice({
                planId: new mongoose.Types.ObjectId().toString(),
                unitAmount: 100,
                productDuration: "monthly",
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe("Plan not found");
        });
    });

    describe("given a plan without a Stripe product", () => {
        it("should return a 400 status code", async () => {
            const { insertedId } = await Plan.collection.insertOne({
                name: "Pro",
            });

            const response = await createPrice({
                planId: insertedId.toString(),
                unitAmount: 100,
                productDuration: "monthly",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Plan has no Stripe product ID");
        });
    });

    describe("given an unsupported productDuration for a plan", () => {
        it("should return a 400 status code", async () => {
            const plan = await seedPlan();
            const response = await createPrice({
                planId: plan._id.toString(),
                unitAmount: 100,
                productDuration: "onetime",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "productDuration must be one of 'daily' | 'weekly' | 'monthly' | 'yearly' for plan prices",
            );
        });

        it("should return a 400 status code when it is missing", async () => {
            const plan = await seedPlan();
            const response = await createPrice({
                planId: plan._id.toString(),
                unitAmount: 100,
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "productDuration must be one of 'daily' | 'weekly' | 'monthly' | 'yearly' for plan prices",
            );
        });
    });

    describe("given a valid assessment price", () => {
        it("should return a 201 status code with the created price", async () => {
            const assessment = await seedAssessment();

            const response = await createPrice({
                assessmentId: assessment._id.toString(),
                unitAmount: 1999,
                metadata: { note: "launch" },
                lookupKey: "iq_one_time",
            });

            expect(response.statusCode).toBe(201);
            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Price created successfully");
            expect(response.body.data.stripePriceId).toBe("price_new");
            expect(response.body.data.price.type).toBe("one_time");
            expect(response.body.data.price.productDuration).toBe("onetime");
            expect(response.body.data.price.currency).toBe("EUR");
            expect(response.body.data.price.default).toBe(true);
            expect(response.body.data.price.lookupKey).toBe("iq_one_time");
        });

        it("should create the Stripe price with the lowercase currency", async () => {
            const assessment = await seedAssessment();

            await createPrice({
                assessmentId: assessment._id.toString(),
                unitAmount: 1999,
                currency: "usd",
                metadata: { note: "launch" },
            });

            expect(mockStripe.prices.create).toHaveBeenCalledWith({
                product: "prod_assessment",
                unit_amount: 1999,
                currency: "usd",
                metadata: {
                    assessmentId: assessment._id.toString(),
                    note: "launch",
                },
            });
        });

        it("should clear the previous default price for the assessment", async () => {
            const assessment = await seedAssessment();
            const previous = await PriceCatalog.create({
                assessmentId: assessment._id,
                stripePriceId: "price_old",
                stripeProductId: "prod_assessment",
                type: "one_time",
                currency: "EUR",
                unitAmount: 999,
                productDuration: "onetime",
                active: true,
                default: true,
            });

            await createPrice({
                assessmentId: assessment._id.toString(),
                unitAmount: 1999,
            });

            const refreshed = await PriceCatalog.findById(previous._id).lean();

            expect(refreshed.default).toBe(false);
        });
    });

    describe("given a valid plan price", () => {
        it("should return a 201 status code with a recurring price", async () => {
            const plan = await seedPlan();

            const response = await createPrice({
                planId: plan._id.toString(),
                unitAmount: 4999,
                productDuration: "yearly",
                intervalCount: 2,
            });

            expect(response.statusCode).toBe(201);
            expect(response.body.data.price.type).toBe("recurring");
            expect(response.body.data.price.productDuration).toBe("yearly");
            expect(mockStripe.prices.create).toHaveBeenCalledWith({
                product: "prod_plan",
                unit_amount: 4999,
                currency: "eur",
                metadata: { planId: plan._id.toString() },
                recurring: { interval: "year", interval_count: 2 },
            });
        });

        it("should fall back to an interval count of one", async () => {
            const plan = await seedPlan();

            await createPrice({
                planId: plan._id.toString(),
                unitAmount: 4999,
                productDuration: "weekly",
                intervalCount: "not-a-number",
            });

            expect(mockStripe.prices.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    recurring: { interval: "week", interval_count: 1 },
                }),
            );
        });

        it("should only clear defaults with the same product duration", async () => {
            const plan = await seedPlan();
            const monthly = await PriceCatalog.create({
                planId: plan._id,
                stripePriceId: "price_monthly",
                stripeProductId: "prod_plan",
                type: "recurring",
                currency: "EUR",
                unitAmount: 999,
                productDuration: "monthly",
                active: true,
                default: true,
            });

            await createPrice({
                planId: plan._id.toString(),
                unitAmount: 4999,
                productDuration: "yearly",
            });

            const refreshed = await PriceCatalog.findById(monthly._id).lean();

            expect(refreshed.default).toBe(true);
        });
    });

    describe("given Stripe rejects the price creation", () => {
        it("should propagate the Stripe status code and message", async () => {
            const assessment = await seedAssessment();
            const stripeError = new Error("No such product: prod_assessment");
            stripeError.statusCode = 400;
            mockStripe.prices.create.mockRejectedValue(stripeError);

            const response = await createPrice({
                assessmentId: assessment._id.toString(),
                unitAmount: 1999,
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "No such product: prod_assessment",
            );
        });

        it("should fall back to a 500 status code", async () => {
            const assessment = await seedAssessment();
            mockStripe.prices.create.mockRejectedValue(new Error("boom"));

            const response = await createPrice({
                assessmentId: assessment._id.toString(),
                unitAmount: 1999,
            });

            expect(response.statusCode).toBe(500);
        });
    });

    describe("given Stripe is not configured", () => {
        it("should reject with the v1 message", async () => {
            const assessment = await seedAssessment();
            const service = new StripeService(logger, null);

            await expect(
                service.createPrice({
                    assessmentId: assessment._id.toString(),
                    unitAmount: 1999,
                }),
            ).rejects.toMatchObject({
                status: 500,
                message: "Stripe is not configured",
            });
        });
    });
});
