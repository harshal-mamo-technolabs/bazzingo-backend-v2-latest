const express = require("express");
const request = require("supertest");
const logger = require("../../src/config/logger");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const { asyncWrapper } = require("../../src/common/utils/wrapper");
const translateRouter = require("../../src/modules/translate/translateRouter");
const {
    TranslateService,
} = require("../../src/modules/translate/translateService");
const {
    TranslateController,
} = require("../../src/modules/translate/translateController");

const buildApp = (router) => {
    const app = express();
    app.use(express.json());
    app.use(requestLogger);
    app.use("/translate", router);
    app.use(globalErrorHandler);
    return app;
};

const buildStubApp = (translateClient, apiKey = "test-key") => {
    const service = new TranslateService(logger, translateClient, apiKey);
    const controller = new TranslateController(service, logger);
    const router = express.Router();
    router.route("/").post(asyncWrapper(controller.translate.bind(controller)));
    return buildApp(router);
};

const okResponse = (translations) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
        data: {
            translations: translations.map((translatedText) => ({
                translatedText,
            })),
        },
    }),
});

const errorResponse = (status, error) => ({
    ok: false,
    status,
    statusText: "Forbidden",
    json: async () => ({ error }),
});

const translateWith = (app, body) => request(app).post("/translate").send(body);

describe("POST /translate", () => {
    describe("given a valid payload", () => {
        it("should return a 200 status code", async () => {
            const client = jest.fn(async () => okResponse(["Hallo"]));

            const response = await translateWith(buildStubApp(client), {
                q: ["Hello"],
                source: "en",
                target: "de",
            });

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope with translatedTexts", async () => {
            const client = jest.fn(async () => okResponse(["Hallo", "Welt"]));

            const response = await translateWith(buildStubApp(client), {
                q: ["Hello", "World"],
                source: "en",
                target: "de",
            });

            expect(response.body.status).toBe("success");
            expect(response.body.data).toEqual({
                translatedTexts: ["Hallo", "Welt"],
            });
        });

        it("should call the Google Translate API once with the payload", async () => {
            const client = jest.fn(async () => okResponse(["Hallo"]));

            await translateWith(buildStubApp(client), {
                q: ["Hello"],
                source: "en",
                target: "de",
            });

            expect(client).toHaveBeenCalledTimes(1);

            const [url, options] = client.mock.calls[0];

            expect(url).toContain(
                "https://translation.googleapis.com/language/translate/v2",
            );
            expect(url).toContain("key=test-key");
            expect(options.method).toBe("POST");
            expect(JSON.parse(options.body)).toEqual({
                q: ["Hello"],
                source: "en",
                target: "de",
                format: "text",
            });
        });

        it("should map the solvik alias to sk and send one request per unique text", async () => {
            const client = jest.fn(async () => okResponse(["Ahoj"]));

            const response = await translateWith(buildStubApp(client), {
                q: ["Hello", "Hello"],
                source: "EN",
                target: "solvik",
            });

            const [, options] = client.mock.calls[0];

            expect(JSON.parse(options.body).q).toEqual(["Hello"]);
            expect(JSON.parse(options.body).target).toBe("sk");
            expect(response.body.data.translatedTexts).toEqual([
                "Ahoj",
                "Ahoj",
            ]);
        });
    });

    describe("given a text that is already cached", () => {
        it("should not call the API again", async () => {
            const client = jest.fn(async () => okResponse(["Hallo"]));
            const app = buildStubApp(client);

            await translateWith(app, {
                q: ["Hello"],
                source: "en",
                target: "de",
            });
            const response = await translateWith(app, {
                q: ["Hello"],
                source: "en",
                target: "de",
            });

            expect(client).toHaveBeenCalledTimes(1);
            expect(response.body.data.translatedTexts).toEqual(["Hallo"]);
        });

        it("should hit the cache for whitespace variations of the text", async () => {
            const client = jest.fn(async () => okResponse(["Hallo Welt"]));
            const app = buildStubApp(client);

            await translateWith(app, {
                q: ["Hello World"],
                source: "en",
                target: "de",
            });
            const response = await translateWith(app, {
                q: ["  Hello   World  "],
                source: "en",
                target: "de",
            });

            expect(client).toHaveBeenCalledTimes(1);
            expect(response.body.data.translatedTexts).toEqual(["Hallo Welt"]);
        });

        it("should not share the cache across language pairs", async () => {
            const client = jest.fn(async () => okResponse(["Bonjour"]));
            const app = buildStubApp(client);

            await translateWith(app, {
                q: ["Hello"],
                source: "en",
                target: "de",
            });
            await translateWith(app, {
                q: ["Hello"],
                source: "en",
                target: "fr",
            });

            expect(client).toHaveBeenCalledTimes(2);
        });
    });

    describe("given an invalid payload", () => {
        const app = buildApp(translateRouter);

        it("should return 400 when q is missing", async () => {
            const response = await translateWith(app, {
                source: "en",
                target: "de",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.status).toBe("error");
            expect(response.body.message).toBe(
                "Texts to translate (q) is required",
            );
        });

        it("should return 400 when q is an empty array", async () => {
            const response = await translateWith(app, {
                q: [],
                source: "en",
                target: "de",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Texts to translate (q) must be a non-empty array",
            );
        });

        it("should return 400 when q is not an array", async () => {
            const response = await translateWith(app, {
                q: "Hello",
                source: "en",
                target: "de",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Texts to translate (q) must be a non-empty array",
            );
        });

        it("should return 400 when source is missing", async () => {
            const response = await translateWith(app, {
                q: ["Hello"],
                target: "de",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Source language code (source) is required",
            );
        });

        it("should return 400 when target is missing", async () => {
            const response = await translateWith(app, {
                q: ["Hello"],
                source: "en",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Target language code (target) is required",
            );
        });
    });

    describe("given the upstream API fails", () => {
        it("should return a 500 status code when the API returns an error", async () => {
            const client = jest.fn(async () =>
                errorResponse(403, {
                    code: 403,
                    message: "User Rate Limit Exceeded",
                }),
            );

            const response = await translateWith(buildStubApp(client), {
                q: ["Hello"],
                source: "en",
                target: "de",
            });

            expect(response.statusCode).toBe(500);
            expect(response.body.status).toBe("error");
            expect(response.body.message).toBe("Something went wrong");
        });

        it("should return a 500 status code when the client rejects", async () => {
            const client = jest.fn(async () => {
                throw new Error("socket hang up");
            });

            const response = await translateWith(buildStubApp(client), {
                q: ["Hello"],
                source: "en",
                target: "de",
            });

            expect(response.statusCode).toBe(500);
        });

        it("should not cache anything when the API fails", async () => {
            const client = jest
                .fn()
                .mockRejectedValueOnce(new Error("socket hang up"))
                .mockResolvedValueOnce(okResponse(["Hallo"]));
            const app = buildStubApp(client);

            await translateWith(app, {
                q: ["Hello"],
                source: "en",
                target: "de",
            });
            const response = await translateWith(app, {
                q: ["Hello"],
                source: "en",
                target: "de",
            });

            expect(client).toHaveBeenCalledTimes(2);
            expect(response.statusCode).toBe(200);
            expect(response.body.data.translatedTexts).toEqual(["Hallo"]);
        });

        it("should return a 500 status code when the API key is not configured", async () => {
            const client = jest.fn();

            const response = await translateWith(buildStubApp(client, ""), {
                q: ["Hello"],
                source: "en",
                target: "de",
            });

            expect(response.statusCode).toBe(500);
            expect(client).not.toHaveBeenCalled();
        });
    });

    describe("TranslateService errors", () => {
        const buildService = (client, apiKey = "test-key") =>
            new TranslateService(logger, client, apiKey);

        it("should reject when the API key is not configured", async () => {
            await expect(
                buildService(jest.fn(), "").translateTexts(
                    ["Hello"],
                    "en",
                    "de",
                ),
            ).rejects.toThrow("GOOGLE_TRANSLATE_KEY is not configured");
        });

        it("should reject when texts is not a non-empty array", async () => {
            await expect(
                buildService(jest.fn()).translateTexts([], "en", "de"),
            ).rejects.toThrow("Texts to translate must be a non-empty array");
        });

        it("should reject when a text is not a string", async () => {
            await expect(
                buildService(jest.fn()).translateTexts([1], "en", "de"),
            ).rejects.toThrow("Text at index 0 must be a string");
        });

        it("should reject an invalid source language code", async () => {
            await expect(
                buildService(jest.fn()).translateTexts(
                    ["Hello"],
                    "english-language",
                    "de",
                ),
            ).rejects.toThrow("Invalid source language code: english-language");
        });

        it("should reject an invalid target language code", async () => {
            await expect(
                buildService(jest.fn()).translateTexts(
                    ["Hello"],
                    "en",
                    "german-language",
                ),
            ).rejects.toThrow("Invalid target language code: german-language");
        });

        it("should reject when the API returns no translations", async () => {
            const client = jest.fn(async () => ({
                ok: true,
                status: 200,
                statusText: "OK",
                json: async () => ({ data: { translations: [] } }),
            }));

            await expect(
                buildService(client).translateTexts(["Hello"], "en", "de"),
            ).rejects.toThrow("No translation returned from API");
        });

        it("should reject with the rate limit message on a 403 rate limit", async () => {
            const client = jest.fn(async () =>
                errorResponse(403, {
                    code: 403,
                    message: "User Rate Limit Exceeded",
                }),
            );

            await expect(
                buildService(client).translateTexts(["Hello"], "en", "de"),
            ).rejects.toThrow(
                "Translation rate limit exceeded after 3 retries. Please try again later.",
            );
        });

        it("should reject with the invalid request message on a 400", async () => {
            const client = jest.fn(async () =>
                errorResponse(400, { code: 400, message: "Invalid Value" }),
            );

            await expect(
                buildService(client).translateTexts(["Hello"], "en", "de"),
            ).rejects.toThrow("Invalid translation request: Invalid Value");
        });

        it("should stay usable after a failed request", async () => {
            const client = jest
                .fn()
                .mockRejectedValueOnce(new Error("socket hang up"))
                .mockResolvedValueOnce(okResponse(["Hallo"]));
            const service = buildService(client);

            await expect(
                service.translateTexts(["Hello"], "en", "de"),
            ).rejects.toThrow("socket hang up");

            await expect(
                service.translateTexts(["Hello"], "en", "de"),
            ).resolves.toEqual(["Hallo"]);
        });
    });
});
