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
    app.use("/helpscout", helpscoutRouter);
    app.use(globalErrorHandler);

    return app;
};

const makeResponse = (body, options = {}) => {
    const status = options.status ?? 200;

    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: options.statusText ?? "OK",
        headers: { get: () => null },
        text: async () =>
            typeof body === "string" ? body : JSON.stringify(body),
    };
};

const authorized = (req) => req.set("Authorization", "Bearer app-secret");

describe("GET /helpscout/klaviyo-profile", () => {
    let app;
    let originalFetch;
    let originalConfig;

    beforeEach(() => {
        app = buildApp();
        originalFetch = globalThis.fetch;
        originalConfig = {
            appSecret: config.HELP_SCOUT_APP_SECRET,
            secret: config.HELP_SCOUT_SECRET,
            apiKey: config.KLAVIYO_PRIVATE_API_KEY,
            baseUrl: config.KLAVIYO_API_BASE_URL,
        };
        globalThis.fetch = jest.fn();
        config.HELP_SCOUT_APP_SECRET = "app-secret";
        config.HELP_SCOUT_SECRET = "";
        config.KLAVIYO_PRIVATE_API_KEY = "pk_private";
        config.KLAVIYO_API_BASE_URL = "https://klaviyo.test/api";
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        config.HELP_SCOUT_APP_SECRET = originalConfig.appSecret;
        config.HELP_SCOUT_SECRET = originalConfig.secret;
        config.KLAVIYO_PRIVATE_API_KEY = originalConfig.apiKey;
        config.KLAVIYO_API_BASE_URL = originalConfig.baseUrl;
    });

    it("fails when no Help Scout app secret is configured", async () => {
        config.HELP_SCOUT_APP_SECRET = "";

        const res = await request(app).get("/helpscout/klaviyo-profile");

        expect(res.status).toBe(500);
        expect(res.body.status).toBe("error");
    });

    it("rejects a request without a bearer token", async () => {
        const res = await request(app).get("/helpscout/klaviyo-profile");

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            status: "error",
            message: "Authentication required",
        });
    });

    it("rejects a malformed authorization header", async () => {
        const res = await request(app)
            .get("/helpscout/klaviyo-profile")
            .set("Authorization", "app-secret");

        expect(res.status).toBe(401);
        expect(res.body.message).toBe("Authentication required");
    });

    it("rejects a wrong bearer token", async () => {
        const res = await request(app)
            .get("/helpscout/klaviyo-profile")
            .set("Authorization", "Bearer nope");

        expect(res.status).toBe(401);
        expect(res.body.message).toBe("Invalid credentials");
    });

    it("requires the email query parameter", async () => {
        const res = await authorized(
            request(app).get("/helpscout/klaviyo-profile"),
        );

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Query parameter "email" is required');
    });

    it("rejects a blank email query parameter", async () => {
        const res = await authorized(
            request(app).get("/helpscout/klaviyo-profile").query({
                email: "   ",
            }),
        );

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Query parameter "email" is required');
    });

    it("rejects an invalid email address", async () => {
        const res = await authorized(
            request(app).get("/helpscout/klaviyo-profile").query({
                email: "not-an-email",
            }),
        );

        expect(res.status).toBe(400);
        expect(res.body.message).toBe("Invalid email address");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns the mapped Klaviyo profile", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse({
                data: [
                    {
                        type: "profile",
                        id: "01H",
                        attributes: {
                            email: "player@bazzingo.com",
                            first_name: "Harshal",
                            properties: { plan: "pro" },
                        },
                    },
                ],
            }),
        );

        const res = await authorized(
            request(app).get("/helpscout/klaviyo-profile").query({
                email: " Player@Bazzingo.com ",
            }),
        );

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("success");
        expect(res.body.message).toBe("Klaviyo profile found");
        expect(res.body.data.email).toBe("player@bazzingo.com");
        expect(res.body.data.profile).toMatchObject({
            id: "01H",
            email: "player@bazzingo.com",
            firstName: "Harshal",
            properties: { plan: "pro" },
        });
    });

    it("reports when Klaviyo has no profile for the email", async () => {
        globalThis.fetch.mockResolvedValue(makeResponse({ data: [] }));

        const res = await authorized(
            request(app).get("/helpscout/klaviyo-profile").query({
                email: "player@bazzingo.com",
            }),
        );

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("No Klaviyo profile for this email");
        expect(res.body.data).toEqual({
            email: "player@bazzingo.com",
            profile: null,
        });
    });

    it("returns 503 when the Klaviyo integration is not configured", async () => {
        config.KLAVIYO_API_BASE_URL = "";

        const res = await authorized(
            request(app).get("/helpscout/klaviyo-profile").query({
                email: "player@bazzingo.com",
            }),
        );

        expect(res.status).toBe(503);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns 502 when the Klaviyo call fails", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse(
                { errors: [{ detail: "Bad key" }] },
                { status: 401, statusText: "Unauthorized" },
            ),
        );

        const res = await authorized(
            request(app).get("/helpscout/klaviyo-profile").query({
                email: "player@bazzingo.com",
            }),
        );

        expect(res.status).toBe(502);
    });
});
