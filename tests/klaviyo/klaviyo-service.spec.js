const logger = require("../../src/config/logger");
const { config } = require("../../src/config");
const { KlaviyoService } = require("../../src/modules/klaviyo/klaviyoService");
const KlaviyoBackup = require("../../src/modules/klaviyo/klaviyoBackupModel");
const { useInMemoryDatabase } = require("../utils/db");

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

const KLAVIYO_PROFILE = {
    type: "profile",
    id: "01H",
    attributes: {
        email: "player@bazzingo.com",
        first_name: "Harshal",
        last_name: "Patel",
        phone_number: "+91",
        external_id: "ext-1",
        title: "Engineer",
        organization: "Bazzingo",
        locale: "en-IN",
        image: "avatar.png",
        created: "2024-01-01T00:00:00Z",
        updated: "2024-02-01T00:00:00Z",
        location: { country: "India" },
        properties: { bazzingo: true },
    },
};

describe("KlaviyoService", () => {
    useInMemoryDatabase();

    let httpClient;
    let service;
    let originalApiKey;
    let originalBaseUrl;

    beforeEach(() => {
        httpClient = jest.fn();
        service = new KlaviyoService(logger, httpClient);
        originalApiKey = config.KLAVIYO_PRIVATE_API_KEY;
        originalBaseUrl = config.KLAVIYO_API_BASE_URL;
        config.KLAVIYO_PRIVATE_API_KEY = "pk_private";
        config.KLAVIYO_API_BASE_URL = "https://klaviyo.test/api";
    });

    afterEach(() => {
        config.KLAVIYO_PRIVATE_API_KEY = originalApiKey;
        config.KLAVIYO_API_BASE_URL = originalBaseUrl;
    });

    describe("getProfileByEmail", () => {
        it("skips when the Klaviyo environment is not configured", async () => {
            config.KLAVIYO_PRIVATE_API_KEY = "";

            const result = await service.getProfileByEmail(
                "player@bazzingo.com",
            );

            expect(result).toEqual({
                skipped: true,
                reason: "Klaviyo env vars missing",
                profile: null,
            });
            expect(httpClient).not.toHaveBeenCalled();
        });

        it("returns a null profile for a blank email without calling Klaviyo", async () => {
            const result = await service.getProfileByEmail("   ");

            expect(result).toEqual({ skipped: false, profile: null });
            expect(httpClient).not.toHaveBeenCalled();
        });

        it("maps the first matching Klaviyo profile", async () => {
            httpClient.mockResolvedValue(
                makeResponse({ data: [KLAVIYO_PROFILE] }),
            );

            const result = await service.getProfileByEmail(
                " Player@Bazzingo.com ",
            );

            expect(result).toEqual({
                skipped: false,
                profile: {
                    id: "01H",
                    email: "player@bazzingo.com",
                    firstName: "Harshal",
                    lastName: "Patel",
                    phoneNumber: "+91",
                    externalId: "ext-1",
                    title: "Engineer",
                    organization: "Bazzingo",
                    locale: "en-IN",
                    image: "avatar.png",
                    created: "2024-01-01T00:00:00Z",
                    updated: "2024-02-01T00:00:00Z",
                    location: { country: "India" },
                    properties: { bazzingo: true },
                },
            });

            const [url, options] = httpClient.mock.calls[0];

            expect(url).toContain("https://klaviyo.test/api/profiles/?");
            expect(decodeURIComponent(url)).toContain(
                'equals(email,"player@bazzingo.com")',
            );
            expect(new URL(url).searchParams.get("page[size]")).toBe("1");
            expect(options.headers).toEqual({
                Authorization: "Klaviyo-API-Key pk_private",
                "Content-Type": "application/json",
                revision: "2024-02-15",
            });
        });

        it("returns a null profile when Klaviyo matched nothing", async () => {
            httpClient.mockResolvedValue(makeResponse({ data: [] }));

            const result = await service.getProfileByEmail(
                "player@bazzingo.com",
            );

            expect(result).toEqual({ skipped: false, profile: null });
        });

        it("throws with the upstream status when Klaviyo fails", async () => {
            httpClient.mockResolvedValue(
                makeResponse(
                    { errors: [{ detail: "Bad key" }] },
                    { status: 401, statusText: "Unauthorized" },
                ),
            );

            await expect(
                service.getProfileByEmail("player@bazzingo.com"),
            ).rejects.toMatchObject({
                message: "[Klaviyo] 401 Unauthorized: Bad key",
                statusCode: 401,
            });
        });
    });

    describe("upsertProfileByEmail", () => {
        it("skips when the email is missing", async () => {
            const result = await service.upsertProfileByEmail({ email: "" });

            expect(result).toEqual({ skipped: true, reason: "email missing" });
            expect(httpClient).not.toHaveBeenCalled();
        });

        it("posts a profile import payload and mirrors it into the backup", async () => {
            httpClient.mockResolvedValue(makeResponse({ data: { id: "1" } }));

            const result = await service.upsertProfileByEmail({
                email: " Player@Bazzingo.com ",
                name: "Harshal Kumar Patel",
                properties: { plan: "pro", ignored: undefined },
            });

            expect(result).toEqual({
                ok: true,
                status: 200,
                data: { data: { id: "1" } },
            });

            const [url, options] = httpClient.mock.calls[0];

            expect(url).toBe("https://klaviyo.test/api/profile-import");
            expect(options.method).toBe("POST");
            expect(JSON.parse(options.body)).toEqual({
                data: {
                    type: "profile",
                    attributes: {
                        email: "player@bazzingo.com",
                        first_name: "Harshal",
                        last_name: "Kumar Patel",
                        properties: { plan: "pro", bazzingo: true },
                    },
                },
            });

            const backup = await KlaviyoBackup.findOne({
                email: "player@bazzingo.com",
            }).lean();

            expect(backup.firstName).toBe("Harshal");
            expect(backup.lastName).toBe("Kumar Patel");
            expect(backup.properties).toEqual({ plan: "pro", bazzingo: true });
        });

        it("merges new properties into the existing backup", async () => {
            httpClient.mockResolvedValue(makeResponse({}));
            await KlaviyoBackup.create({
                email: "player@bazzingo.com",
                properties: { plan: "free", country: "India" },
            });

            await service.upsertProfileByEmail({
                email: "player@bazzingo.com",
                properties: { plan: "pro" },
            });

            const backup = await KlaviyoBackup.findOne({
                email: "player@bazzingo.com",
            }).lean();

            expect(backup.properties).toEqual({
                plan: "pro",
                country: "India",
                bazzingo: true,
            });
        });

        it("throws when Klaviyo rejects the profile import", async () => {
            httpClient.mockResolvedValue(
                makeResponse(
                    { message: "nope" },
                    { status: 400, statusText: "Bad Request" },
                ),
            );

            await expect(
                service.upsertProfileByEmail({
                    email: "player@bazzingo.com",
                }),
            ).rejects.toMatchObject({
                message: "[Klaviyo] 400 Bad Request: nope",
                statusCode: 400,
            });
        });
    });

    describe("createEvent", () => {
        it("skips when the email is missing", async () => {
            const result = await service.createEvent({
                metricName: "Account Deleted",
            });

            expect(result).toEqual({ skipped: true, reason: "email missing" });
        });

        it("skips when the metric name is missing", async () => {
            const result = await service.createEvent({
                email: "player@bazzingo.com",
            });

            expect(result).toEqual({
                skipped: true,
                reason: "metricName missing",
            });
        });

        it("falls back to an action property when none are supplied", async () => {
            httpClient.mockResolvedValue(makeResponse({}));

            await service.createEvent({
                email: "player@bazzingo.com",
                metricName: "Account Deleted",
                uniqueId: "evt-1",
                timeISO: "2024-05-01T00:00:00Z",
            });

            const [url, options] = httpClient.mock.calls[0];

            expect(url).toBe("https://klaviyo.test/api/events");
            expect(JSON.parse(options.body)).toEqual({
                data: {
                    type: "event",
                    attributes: {
                        properties: { action: "Account Deleted" },
                        metric: {
                            data: {
                                type: "metric",
                                attributes: { name: "Account Deleted" },
                            },
                        },
                        profile: {
                            data: {
                                type: "profile",
                                attributes: {
                                    email: "player@bazzingo.com",
                                },
                            },
                        },
                        unique_id: "evt-1",
                        time: "2024-05-01T00:00:00Z",
                    },
                },
            });
        });

        it("skips the call when the Klaviyo environment is missing", async () => {
            config.KLAVIYO_API_BASE_URL = "";

            const result = await service.createEvent({
                email: "player@bazzingo.com",
                metricName: "Account Deleted",
            });

            expect(result).toEqual({
                skipped: true,
                reason: "Klaviyo env vars missing",
            });
            expect(httpClient).not.toHaveBeenCalled();
        });
    });
});
