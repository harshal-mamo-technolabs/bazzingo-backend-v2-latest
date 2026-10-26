const crypto = require("crypto");
const logger = require("../../src/config/logger");
const { config } = require("../../src/config");
const {
    HelpscoutService,
} = require("../../src/modules/helpscout/helpscoutService");

const makeResponse = (options = {}) => {
    const status = options.status ?? 200;
    const headers = options.headers ?? {};

    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: (key) => headers[String(key).toLowerCase()] ?? null,
        },
        text: async () =>
            typeof options.body === "string"
                ? options.body
                : JSON.stringify(options.body ?? {}),
        json: async () => options.body ?? {},
    };
};

const TOKEN_RESPONSE = makeResponse({
    body: { access_token: "token-1", expires_in: 172800 },
});

describe("HelpscoutService", () => {
    let httpClient;
    let service;
    let originalConfig;

    beforeEach(() => {
        httpClient = jest.fn();
        service = new HelpscoutService(logger, httpClient);
        originalConfig = {
            secret: config.HELP_SCOUT_SECRET,
            appId: config.HELP_SCOUT_MAILBOX_APP_ID,
            appSecret: config.HELP_SCOUT_MAILBOX_APP_SECRET,
        };
        config.HELP_SCOUT_SECRET = "help-scout-secret-value-long-enough";
        config.HELP_SCOUT_MAILBOX_APP_ID = "mailbox-id";
        config.HELP_SCOUT_MAILBOX_APP_SECRET = "mailbox-secret";
    });

    afterEach(() => {
        config.HELP_SCOUT_SECRET = originalConfig.secret;
        config.HELP_SCOUT_MAILBOX_APP_ID = originalConfig.appId;
        config.HELP_SCOUT_MAILBOX_APP_SECRET = originalConfig.appSecret;
    });

    describe("generateSignature", () => {
        it("signs the normalized email and defaults the name to it", () => {
            const result = service.generateSignature({
                _id: "abc",
                email: " Player@Bazzingo.com ",
            });

            expect(result.signature).toBe(
                crypto
                    .createHmac("sha256", "help-scout-secret-value-long-enough")
                    .update("player@bazzingo.com")
                    .digest("base64"),
            );
            expect(result.payload).toEqual({
                id: "abc",
                email: "player@bazzingo.com",
                name: "player@bazzingo.com",
                properties: {
                    utm_source: "organic",
                    utm_campaign: "organic",
                    utm_medium: "organic",
                },
            });
            expect(result.expiresAt).toBeGreaterThanOrEqual(
                Math.floor(Date.now() / 1000) + 3599,
            );
            expect(result.expiresAt).toBeLessThanOrEqual(
                Math.floor(Date.now() / 1000) + 3600,
            );
        });

        it("throws when the Help Scout secret is not configured", () => {
            config.HELP_SCOUT_SECRET = "";

            expect(() =>
                service.generateSignature({ email: "a@b.com" }),
            ).toThrow("HELP_SCOUT_SECRET is not configured");
        });

        it("throws when no user is supplied", () => {
            expect(() => service.generateSignature(null)).toThrow(
                "User is required to generate Help Scout signature",
            );
        });

        it("throws when the user has no email", () => {
            expect(() => service.generateSignature({ _id: "abc" })).toThrow(
                "Help Scout signatures require a user email",
            );
        });
    });

    describe("syncUserUtmToHelpScout", () => {
        it("skips when the mailbox credentials are missing", async () => {
            config.HELP_SCOUT_MAILBOX_APP_ID = "";

            const result = await service.syncUserUtmToHelpScout({
                email: "player@bazzingo.com",
            });

            expect(result).toEqual({
                skipped: true,
                reason: "mailbox_api_not_configured",
            });
            expect(httpClient).not.toHaveBeenCalled();
        });

        it("skips when the user has no email", async () => {
            const result = await service.syncUserUtmToHelpScout({});

            expect(result).toEqual({
                skipped: true,
                reason: "missing_email",
            });
        });

        it("patches the properties of an existing customer", async () => {
            httpClient
                .mockResolvedValueOnce(TOKEN_RESPONSE)
                .mockResolvedValueOnce(
                    makeResponse({
                        body: { _embedded: { customers: [{ id: 42 }] } },
                    }),
                )
                .mockResolvedValueOnce(makeResponse({ status: 204 }));

            const result = await service.syncUserUtmToHelpScout({
                email: "Player@Bazzingo.com",
                name: "Harshal Patel",
                utmSource: "newsletter",
            });

            expect(result).toEqual({ ok: true, customerId: 42 });

            const [tokenUrl, tokenOptions] = httpClient.mock.calls[0];

            expect(tokenUrl).toBe("https://api.helpscout.net/v2/oauth2/token");
            expect(tokenOptions.body).toContain(
                "grant_type=client_credentials",
            );

            const [searchUrl] = httpClient.mock.calls[1];

            expect(decodeURIComponent(searchUrl)).toBe(
                'https://api.helpscout.net/v2/customers?query=(email:"player@bazzingo.com")',
            );

            const [patchUrl, patchOptions] = httpClient.mock.calls[2];

            expect(patchUrl).toBe(
                "https://api.helpscout.net/v2/customers/42/properties",
            );
            expect(patchOptions.method).toBe("PATCH");
            expect(JSON.parse(patchOptions.body)).toEqual([
                { op: "replace", path: "/utm_source", value: "newsletter" },
                { op: "replace", path: "/utm_campaign", value: "organic" },
                { op: "replace", path: "/utm_medium", value: "organic" },
            ]);
        });

        it("creates the customer when Help Scout has none", async () => {
            httpClient
                .mockResolvedValueOnce(TOKEN_RESPONSE)
                .mockResolvedValueOnce(
                    makeResponse({ body: { _embedded: { customers: [] } } }),
                )
                .mockResolvedValueOnce(
                    makeResponse({
                        status: 201,
                        headers: { "resource-id": "99" },
                    }),
                );

            const result = await service.syncUserUtmToHelpScout({
                email: "player@bazzingo.com",
                name: "Harshal Kumar Patel",
            });

            expect(result).toEqual({ ok: true, customerId: 99 });

            const [createUrl, createOptions] = httpClient.mock.calls[2];

            expect(createUrl).toBe("https://api.helpscout.net/v2/customers");
            expect(JSON.parse(createOptions.body)).toEqual({
                firstName: "Harshal",
                lastName: "Kumar Patel",
                emails: [{ type: "work", value: "player@bazzingo.com" }],
                properties: [
                    { slug: "utm_source", value: "organic" },
                    { slug: "utm_campaign", value: "organic" },
                    { slug: "utm_medium", value: "organic" },
                ],
            });
        });

        it("reports a failed customer search instead of throwing", async () => {
            httpClient
                .mockResolvedValueOnce(TOKEN_RESPONSE)
                .mockResolvedValueOnce(
                    makeResponse({ status: 500, body: "upstream down" }),
                );

            const result = await service.syncUserUtmToHelpScout({
                email: "player@bazzingo.com",
                name: "Harshal",
            });

            expect(result).toEqual({
                ok: false,
                error: "Help Scout customer search failed (500): upstream down",
            });
        });

        it("reports a failed oauth exchange instead of throwing", async () => {
            httpClient.mockResolvedValueOnce(
                makeResponse({
                    status: 401,
                    body: { error_description: "bad client" },
                }),
            );

            const result = await service.syncUserUtmToHelpScout({
                email: "player@bazzingo.com",
                name: "Harshal",
            });

            expect(result).toEqual({
                ok: false,
                error: "Help Scout OAuth failed (401): bad client",
            });
        });
    });

    describe("scheduleSyncContactUtmToHelpScout", () => {
        it("does nothing without an email", () => {
            service.scheduleSyncContactUtmToHelpScout({});

            expect(httpClient).not.toHaveBeenCalled();
        });

        it("defaults the attribution before syncing", async () => {
            httpClient
                .mockResolvedValueOnce(TOKEN_RESPONSE)
                .mockResolvedValueOnce(
                    makeResponse({
                        body: { _embedded: { customers: [{ id: 7 }] } },
                    }),
                )
                .mockResolvedValueOnce(makeResponse({ status: 200 }));

            service.scheduleSyncContactUtmToHelpScout({
                email: "player@bazzingo.com",
            });

            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setImmediate(resolve));

            expect(httpClient).toHaveBeenCalled();
        });
    });
});
