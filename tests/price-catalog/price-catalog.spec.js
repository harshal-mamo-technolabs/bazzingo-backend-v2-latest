const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const priceCatalogRouter = require("../../src/modules/price-catalog/priceCatalogRouter");
const { useInMemoryDatabase } = require("../utils/db");
const {
    createAdmin,
    createUser,
    getAdminToken,
    getAccessToken,
} = require("../utils/fixtures");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/price-catalogs", priceCatalogRouter);
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const validBody = {
    stripePriceId: "price_123",
    stripeProductId: "prod_123",
    type: "recurring",
    lookupKey: "pro_monthly",
    unitAmount: 1999,
};

describe("POST /price-catalogs", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        adminToken = getAdminToken((await createAdmin())._id);
    });

    const create = (body = validBody, token = adminToken) =>
        request(app)
            .post("/price-catalogs")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    describe("given a valid body", () => {
        it("should return a 201 with the v1 envelope", async () => {
            const response = await create();

            expect(response.statusCode).toBe(201);
            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("PriceCatalog entry created");
            expect(response.body.data.price.stripePriceId).toBe("price_123");
            expect(response.body.data.price.unitAmount).toBe(1999);
        });

        it("should apply the v1 defaults", async () => {
            await create();

            const saved = await PriceCatalog.findOne({});
            expect(saved.currency).toBe("EUR");
            expect(saved.active).toBe(true);
            expect(saved.default).toBe(false);
            expect(saved.productDuration).toBe("monthly");
            expect(saved.lookupKey).toBe("pro_monthly");
        });

        it("should uppercase the currency", async () => {
            const response = await create({ ...validBody, currency: "usd" });

            expect(response.body.data.price.currency).toBe("USD");
        });

        it("should store the optional relations and flags", async () => {
            const assessmentId = new mongoose.Types.ObjectId();
            const planId = new mongoose.Types.ObjectId();

            await create({
                ...validBody,
                assessmentId: String(assessmentId),
                planId: String(planId),
                active: false,
                default: true,
                productDuration: "yearly",
                metadata: { tier: "gold" },
            });

            const saved = await PriceCatalog.findOne({});
            expect(String(saved.assessmentId)).toBe(String(assessmentId));
            expect(String(saved.planId)).toBe(String(planId));
            expect(saved.active).toBe(false);
            expect(saved.default).toBe(true);
            expect(saved.productDuration).toBe("yearly");
            expect(saved.metadata.get("tier")).toBe("gold");
        });

        it("should omit the relations when they are not sent", async () => {
            await create();

            const saved = await PriceCatalog.findOne({});
            expect(saved.assessmentId).toBeUndefined();
            expect(saved.planId).toBeUndefined();
        });
    });

    describe("given an invalid body", () => {
        it("should return a 400 when stripePriceId is missing", async () => {
            const { stripePriceId, ...body } = validBody;

            const response = await create(body);

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("stripePriceId is required");
            expect(await PriceCatalog.countDocuments()).toBe(0);
        });

        it("should return a 400 when stripeProductId is missing", async () => {
            const { stripeProductId, ...body } = validBody;

            const response = await create(body);

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("stripeProductId is required");
        });

        it("should return a 400 when type is missing", async () => {
            const { type, ...body } = validBody;

            const response = await create(body);

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "type is required (recurring | one_time)",
            );
        });

        it("should return a 400 when unitAmount is missing", async () => {
            const { unitAmount, ...body } = validBody;

            const response = await create(body);

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "unitAmount is required and must be a number",
            );
        });

        it("should return a 400 when unitAmount is not a number", async () => {
            const response = await create({ ...validBody, unitAmount: "1999" });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "unitAmount is required and must be a number",
            );
        });
    });

    describe("authorisation", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post("/price-catalogs")
                .send(validBody);

            expect(response.statusCode).toBe(401);
            expect(response.body.message).toBe("Admin authentication required");
        });

        it("should return a 401 for a user token", async () => {
            const user = await createUser();

            const response = await create(validBody, getAccessToken(user._id));

            expect(response.statusCode).toBe(401);
        });
    });
});
