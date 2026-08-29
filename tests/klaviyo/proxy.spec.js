const request = require("supertest");
const express = require("express");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const klaviyoRouter = require("../../src/modules/klaviyo/klaviyoRouter");
const { config } = require("../../src/config");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/klaviyo", klaviyoRouter);
    app.use(globalErrorHandler);

    return app;
};

const makeResponse = (body, options = {}) => {
    const status = options.status ?? 200;
    const headers = options.headers ?? {};

    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: options.statusText ?? "OK",
        headers: {
            get: (key) => headers[String(key).toLowerCase()] ?? null,
        },
        text: async () =>
            typeof body === "string" ? body : JSON.stringify(body),
    };
};

const lastUrl = (call) => new URL(call[0]);

describe("GET /klaviyo/profiles", () => {
    let app;
    let originalFetch;
    let originalBaseUrl;

    beforeEach(() => {
        app = buildApp();
        originalFetch = globalThis.fetch;
        originalBaseUrl = config.KLAVIYO_API_BASE_URL;
        globalThis.fetch = jest.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        config.KLAVIYO_API_BASE_URL = originalBaseUrl;
    });

    it("rejects a request without the klaviyo-api-key query parameter", async () => {
        const res = await request(app).get("/klaviyo/profiles");

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
            status: "error",
            message: "klaviyo-api-key query parameter is required",
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("rejects a blank klaviyo-api-key", async () => {
        const res = await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "   ",
        });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe(
            "klaviyo-api-key query parameter is required",
        );
    });

    it("returns every profile combined across cursor pages", async () => {
        globalThis.fetch
            .mockResolvedValueOnce(
                makeResponse({
                    data: [{ id: "1", type: "profile" }],
                    links: {
                        self: "page-1",
                        next: "https://a.klaviyo.com/api/profiles?page[cursor]=2",
                    },
                    included: [{ id: "i1" }],
                }),
            )
            .mockResolvedValueOnce(
                makeResponse({
                    data: [{ id: "2", type: "profile" }],
                    links: { self: "page-2", next: null },
                    meta: { total: 2 },
                }),
            );

        const res = await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            data: [
                { id: "1", type: "profile" },
                { id: "2", type: "profile" },
            ],
            links: { self: "page-2", next: null, prev: null },
            meta: { total: 2 },
            included: [{ id: "i1" }],
        });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("clamps the profiles page size to the Klaviyo maximum", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse({ data: [], links: { next: null } }),
        );

        await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
            page_size: "500",
        });

        expect(
            lastUrl(globalThis.fetch.mock.calls[0]).searchParams.get(
                "page[size]",
            ),
        ).toBe("19");
    });

    it("uses the default Klaviyo base url, revision and auth header", async () => {
        config.KLAVIYO_API_BASE_URL = "";
        globalThis.fetch.mockResolvedValue(
            makeResponse({ data: [], links: { next: null } }),
        );

        await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
        });

        const [url, options] = globalThis.fetch.mock.calls[0];

        expect(url).toContain("https://a.klaviyo.com/api/profiles?");
        expect(options.method).toBe("GET");
        expect(options.headers).toEqual({
            Authorization: "Klaviyo-API-Key pk_live_123",
            "Content-Type": "application/json",
            revision: "2026-04-15",
        });
    });

    it("honours a caller supplied revision", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse({ data: [], links: { next: null } }),
        );

        await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
            revision: "2024-10-15",
        });

        expect(globalThis.fetch.mock.calls[0][1].headers.revision).toBe(
            "2024-10-15",
        );
    });

    it("stops when Klaviyo repeats a pagination cursor", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse({
                data: [{ id: "1", type: "profile" }],
                links: {
                    next: "https://a.klaviyo.com/api/profiles?page[size]=19",
                },
            }),
        );

        const res = await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(200);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        expect(res.body.data).toHaveLength(2);
    });

    it("passes an upstream 4xx status and detail through", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse(
                { errors: [{ detail: "Invalid API key" }] },
                { status: 401, statusText: "Unauthorized" },
            ),
        );

        const res = await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(401);
        expect(res.body.message).toBe(
            "[KlaviyoProxy] 401 Unauthorized: Invalid API key",
        );
    });

    it("keeps the upstream 5xx status", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse("boom", { status: 503, statusText: "Unavailable" }),
        );

        const res = await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(503);
    });

    it("falls back to 502 when the upstream failure carries no status", async () => {
        globalThis.fetch.mockRejectedValue(new Error("socket hang up"));

        const res = await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(502);
    });

    it("retries after a 429 and returns the retried page", async () => {
        globalThis.fetch
            .mockResolvedValueOnce(
                makeResponse("", {
                    status: 429,
                    statusText: "Too Many Requests",
                    headers: { "retry-after": "0" },
                }),
            )
            .mockResolvedValueOnce(
                makeResponse({
                    data: [{ id: "1", type: "profile" }],
                    links: { next: null },
                }),
            );

        const res = await request(app).get("/klaviyo/profiles").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    }, 20000);
});

describe("GET /klaviyo/events", () => {
    let app;
    let originalFetch;

    beforeEach(() => {
        app = buildApp();
        originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("rejects a request without the klaviyo-api-key query parameter", async () => {
        const res = await request(app).get("/klaviyo/events");

        expect(res.status).toBe(400);
        expect(res.body.message).toBe(
            "klaviyo-api-key query parameter is required",
        );
    });

    it("defaults to a page size of 200", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse({ data: [], links: { next: null } }),
        );

        const res = await request(app).get("/klaviyo/events").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(200);
        expect(
            lastUrl(globalThis.fetch.mock.calls[0]).searchParams.get(
                "page[size]",
            ),
        ).toBe("200");
        expect(res.body).toEqual({
            data: [],
            links: { next: null, prev: null },
        });
    });

    it("uses a caller supplied page size below the maximum", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse({ data: [], links: { next: null } }),
        );

        await request(app).get("/klaviyo/events").query({
            "klaviyo-api-key": "pk_live_123",
            page_size: "25",
        });

        expect(
            lastUrl(globalThis.fetch.mock.calls[0]).searchParams.get(
                "page[size]",
            ),
        ).toBe("25");
    });

    it("passes an upstream failure through", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse(
                { message: "nope" },
                { status: 403, statusText: "Forbidden" },
            ),
        );

        const res = await request(app).get("/klaviyo/events").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(403);
        expect(res.body.message).toBe("[KlaviyoProxy] 403 Forbidden: nope");
    });
});

describe("GET /klaviyo/metrics", () => {
    let app;
    let originalFetch;

    beforeEach(() => {
        app = buildApp();
        originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("rejects a request without the klaviyo-api-key query parameter", async () => {
        const res = await request(app).get("/klaviyo/metrics");

        expect(res.status).toBe(400);
        expect(res.body.message).toBe(
            "klaviyo-api-key query parameter is required",
        );
    });

    it("never sends a page size parameter", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse({
                data: [{ id: "m1", type: "metric" }],
                links: { next: null },
            }),
        );

        const res = await request(app).get("/klaviyo/metrics").query({
            "klaviyo-api-key": "pk_live_123",
            page_size: "10",
        });

        expect(res.status).toBe(200);
        expect(globalThis.fetch.mock.calls[0][0]).not.toContain("page[size]");
        expect(res.body.data).toEqual([{ id: "m1", type: "metric" }]);
    });

    it("passes an upstream failure through", async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse("", { status: 404, statusText: "Not Found" }),
        );

        const res = await request(app).get("/klaviyo/metrics").query({
            "klaviyo-api-key": "pk_live_123",
        });

        expect(res.status).toBe(404);
        expect(res.body.message).toBe(
            "[KlaviyoProxy] 404 Not Found: Unknown Klaviyo error",
        );
    });
});
