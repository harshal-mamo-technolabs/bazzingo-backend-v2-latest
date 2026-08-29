const request = require("supertest");
const express = require("express");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const helpscoutRouter = require("../../src/modules/helpscout/helpscoutRouter");
const { config } = require("../../src/config");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use((req, res, next) => {
        res.setHeader("X-Frame-Options", "DENY");
        next();
    });
    app.use("/helpscout", helpscoutRouter);
    app.use(globalErrorHandler);

    return app;
};

describe("GET /helpscout/profile-sidebar", () => {
    let app;
    let originalSecret;
    let originalAppSecret;

    beforeEach(() => {
        app = buildApp();
        originalSecret = config.HELP_SCOUT_SECRET;
        originalAppSecret = config.HELP_SCOUT_APP_SECRET;
    });

    afterEach(() => {
        config.HELP_SCOUT_SECRET = originalSecret;
        config.HELP_SCOUT_APP_SECRET = originalAppSecret;
    });

    it("renders the sidebar page embedding the app secret", async () => {
        config.HELP_SCOUT_APP_SECRET = "app-secret";
        config.HELP_SCOUT_SECRET = "beacon-secret";

        const res = await request(app).get("/helpscout/profile-sidebar");

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.headers["content-security-policy"]).toBe(
            "frame-ancestors https://secure.helpscout.net https://*.helpscout.net",
        );
        expect(res.headers["x-frame-options"]).toBeUndefined();
        expect(res.text).toContain("<title>Klaviyo profile</title>");
        expect(res.text).toContain('const API_TOKEN = "app-secret";');
        expect(res.text).toContain("/helpscout/klaviyo-profile");
    });

    it("falls back to the Beacon secret when no app secret is set", async () => {
        config.HELP_SCOUT_APP_SECRET = "";
        config.HELP_SCOUT_SECRET = "beacon-secret";

        const res = await request(app).get("/helpscout/profile-sidebar");

        expect(res.status).toBe(200);
        expect(res.text).toContain('const API_TOKEN = "beacon-secret";');
    });

    it("returns an html misconfiguration page when no secret is set", async () => {
        config.HELP_SCOUT_APP_SECRET = "";
        config.HELP_SCOUT_SECRET = "";

        const res = await request(app).get("/helpscout/profile-sidebar");

        expect(res.status).toBe(500);
        expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
        expect(res.text).toBe(
            "<!DOCTYPE html><html><body><p>Server misconfiguration: set HELP_SCOUT_APP_SECRET or HELP_SCOUT_SECRET.</p></body></html>",
        );
        expect(res.headers["content-security-policy"]).toBe(
            "frame-ancestors https://secure.helpscout.net https://*.helpscout.net",
        );
    });
});
