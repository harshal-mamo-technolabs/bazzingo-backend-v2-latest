const crypto = require("crypto");
const request = require("supertest");
const express = require("express");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const helpscoutRouter = require("../../src/modules/helpscout/helpscoutRouter");
const { config } = require("../../src/config");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/helpscout", helpscoutRouter);
    app.use(globalErrorHandler);

    return app;
};

describe("GET /helpscout/user-signature", () => {
    useInMemoryDatabase();

    let app;
    let originalSecret;

    beforeEach(() => {
        app = buildApp();
        originalSecret = config.HELP_SCOUT_SECRET;
        config.HELP_SCOUT_SECRET = "help-scout-secret-value-long-enough";
    });

    afterEach(() => {
        config.HELP_SCOUT_SECRET = originalSecret;
    });

    it("rejects an unauthenticated request", async () => {
        const res = await request(app).get("/helpscout/user-signature");

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            status: "error",
            message: "Authentication required",
        });
    });

    it("returns the Beacon identify payload for the signed in user", async () => {
        const user = await createUser({
            email: "Player@Bazzingo.com",
            name: "Harshal Patel",
            utmSource: "newsletter",
        });

        const res = await request(app)
            .get("/helpscout/user-signature")
            .set("Authorization", `Bearer ${getAccessToken(user._id)}`);

        const expectedSignature = crypto
            .createHmac("sha256", "help-scout-secret-value-long-enough")
            .update("player@bazzingo.com")
            .digest("base64");

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("success");
        expect(res.body.message).toBe("Help Scout signature generated");
        expect(res.body.data.signature).toBe(expectedSignature);
        expect(res.body.data.user).toEqual({
            id: String(user._id),
            email: "player@bazzingo.com",
            name: "Harshal Patel",
            properties: {
                utm_source: "newsletter",
                utm_campaign: "default",
                utm_medium: "default",
            },
        });
        expect(res.body.data.properties).toEqual(res.body.data.user.properties);
        expect(typeof res.body.data.expiresAt).toBe("number");
        expect(res.body.data.expiresAt).toBeGreaterThan(
            Math.floor(Date.now() / 1000),
        );
    });

    it("fails when the Help Scout secret is not configured", async () => {
        config.HELP_SCOUT_SECRET = "";

        const user = await createUser();

        const res = await request(app)
            .get("/helpscout/user-signature")
            .set("Authorization", `Bearer ${getAccessToken(user._id)}`);

        expect(res.status).toBe(500);
        expect(res.body).toEqual({
            status: "error",
            message: "Something went wrong",
        });
    });
});
