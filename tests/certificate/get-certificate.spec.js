const express = require("express");
const request = require("supertest");
const logger = require("../../src/config/logger");
const { config } = require("../../src/config");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const { asyncWrapper } = require("../../src/common/utils/wrapper");
const {
    CertificateController,
} = require("../../src/modules/certificate/certificateController");
const {
    CertificateService,
} = require("../../src/modules/certificate/certificateService");

const PDF_BUFFER = Buffer.from("%PDF-1.4 certificate");
const IMAGE_BUFFER = Buffer.from("certificate-image-bytes");
const QR_DATA_URL = "data:image/png;base64,QRCODE";
const DEFAULT_CERT_ID = "BZG-2024-175839";

const createHandle = () => ({
    screenshot: jest.fn().mockResolvedValue(IMAGE_BUFFER),
});

const createPage = (overrides = {}) => ({
    setDefaultTimeout: jest.fn(),
    setViewport: jest.fn().mockResolvedValue(undefined),
    setContent: jest.fn().mockResolvedValue(undefined),
    emulateMediaType: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(PDF_BUFFER),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

const buildHarness = ({ page, generateQrDataUrl } = {}) => {
    const handle = createHandle();
    const activePage =
        page || createPage({ $: jest.fn().mockResolvedValue(handle) });
    const browser = {
        isConnected: jest.fn().mockReturnValue(true),
        newPage: jest.fn().mockResolvedValue(activePage),
        close: jest.fn().mockResolvedValue(undefined),
    };
    const launchBrowser = jest.fn().mockResolvedValue(browser);
    const qr = generateQrDataUrl || jest.fn().mockResolvedValue(QR_DATA_URL);
    const service = new CertificateService(logger, {
        launchBrowser,
        generateQrDataUrl: qr,
    });
    const controller = new CertificateController(service, logger);

    const app = express();
    app.use(express.json());
    app.use(requestLogger);

    const router = express.Router();
    router
        .route("/")
        .get(asyncWrapper(controller.getCertificate.bind(controller)));
    app.use("/certificate", router);
    app.use(globalErrorHandler);

    return {
        app,
        page: activePage,
        handle,
        browser,
        launchBrowser,
        generateQrDataUrl: qr,
        service,
    };
};

const renderedHtml = (page) => page.setContent.mock.calls[0][0];

describe("GET /certificate", () => {
    describe("given no query parameters", () => {
        it("should return a 200 status code", async () => {
            const { app } = buildHarness();

            const response = await request(app).get("/certificate");

            expect(response.statusCode).toBe(200);
        });

        it("should return the generated pdf as an attachment", async () => {
            const { app } = buildHarness();

            const response = await request(app).get("/certificate");

            expect(response.headers["content-type"]).toBe("application/pdf");
            expect(response.headers["content-disposition"]).toBe(
                `attachment; filename="certificate-${DEFAULT_CERT_ID}.pdf"`,
            );
            expect(Buffer.from(response.body)).toEqual(PDF_BUFFER);
        });

        it("should return the no-store cache headers", async () => {
            const { app } = buildHarness();

            const response = await request(app).get("/certificate");

            expect(response.headers["cache-control"]).toBe(
                "no-cache, no-store, must-revalidate",
            );
            expect(response.headers["pragma"]).toBe("no-cache");
            expect(response.headers["expires"]).toBe("0");
        });

        it("should render the v1 fallback certificate data", async () => {
            const { app, page } = buildHarness();

            await request(app).get("/certificate");

            const html = renderedHtml(page);
            expect(html).toContain("Christopher Taylor");
            expect(html).toContain("126");
            expect(html).toContain("Confidence Interval 119–133");
            expect(html).toContain("Percentile Rank 96");
            expect(html).toContain(DEFAULT_CERT_ID);
        });

        it("should embed the qr code generated for the certificate id", async () => {
            const { app, page, generateQrDataUrl } = buildHarness();

            await request(app).get("/certificate");

            expect(generateQrDataUrl).toHaveBeenCalledWith(DEFAULT_CERT_ID, {
                margin: 0,
            });
            expect(renderedHtml(page)).toContain(QR_DATA_URL);
        });

        it("should render the page before printing it", async () => {
            const { app, page } = buildHarness();

            await request(app).get("/certificate");

            expect(page.setViewport).toHaveBeenCalledWith({
                width: 1200,
                height: 800,
                deviceScaleFactor: 1,
            });
            expect(page.setContent).toHaveBeenCalledWith(expect.any(String), {
                waitUntil: "networkidle0",
            });
            expect(page.emulateMediaType).toHaveBeenCalledWith("screen");
            expect(page.pdf).toHaveBeenCalledWith(
                expect.objectContaining({
                    format: "A4",
                    landscape: true,
                    printBackground: true,
                    scale: 0.75,
                }),
            );
        });

        it("should close the page and keep the browser alive", async () => {
            const { app, page, browser } = buildHarness();

            await request(app).get("/certificate");

            expect(page.close).toHaveBeenCalledTimes(1);
            expect(browser.close).not.toHaveBeenCalled();
        });
    });

    describe("given certificate query parameters", () => {
        it("should render the supplied values", async () => {
            const { app, page } = buildHarness();

            await request(app).get("/certificate").query({
                name: "Ada Lovelace",
                score: "141",
                ciLow: "134",
                ciHigh: "148",
                percentile: "99",
                reasoning: "145",
                verbal: "138",
                memory: "132",
                speed: "140",
                certId: "BZG-2026-000001",
            });

            const html = renderedHtml(page);
            expect(html).toContain("Ada Lovelace");
            expect(html).toContain("141");
            expect(html).toContain("Confidence Interval 134–148");
            expect(html).toContain("BZG-2026-000001");
        });

        it("should name the download after the certificate id", async () => {
            const { app } = buildHarness();

            const response = await request(app)
                .get("/certificate")
                .query({ certId: "BZG-2026-000001" });

            expect(response.headers["content-disposition"]).toBe(
                'attachment; filename="certificate-BZG-2026-000001.pdf"',
            );
        });
    });

    describe("given a format query parameter", () => {
        it("should screenshot the certificate element for png", async () => {
            const { app, page, handle } = buildHarness();

            const response = await request(app)
                .get("/certificate")
                .query({ format: "png" });

            expect(page.pdf).not.toHaveBeenCalled();
            expect(page.$).toHaveBeenCalledWith(".certificate");
            expect(handle.screenshot).toHaveBeenCalledWith({
                type: "png",
                quality: undefined,
                omitBackground: false,
            });
            expect(response.headers["content-disposition"]).toBe(
                `attachment; filename="certificate-${DEFAULT_CERT_ID}.png"`,
            );
        });

        it("should keep the v1 application/pdf content type for images", async () => {
            const { app } = buildHarness();

            const response = await request(app)
                .get("/certificate")
                .query({ format: "png" });

            expect(response.headers["content-type"]).toBe("application/pdf");
        });

        it("should map jpg to a jpeg screenshot named .jpg", async () => {
            const { app, handle } = buildHarness();

            const response = await request(app)
                .get("/certificate")
                .query({ format: "jpg" });

            expect(handle.screenshot).toHaveBeenCalledWith({
                type: "jpeg",
                quality: 90,
                omitBackground: false,
            });
            expect(response.headers["content-disposition"]).toBe(
                `attachment; filename="certificate-${DEFAULT_CERT_ID}.jpg"`,
            );
        });

        it("should lowercase the requested format", async () => {
            const { app, handle } = buildHarness();

            await request(app).get("/certificate").query({ format: "JPEG" });

            expect(handle.screenshot).toHaveBeenCalledWith({
                type: "jpeg",
                quality: 90,
                omitBackground: false,
            });
        });

        it("should fall back to pdf for an unknown format", async () => {
            const { app, page } = buildHarness();

            const response = await request(app)
                .get("/certificate")
                .query({ format: "gif" });

            expect(page.pdf).toHaveBeenCalledTimes(1);
            expect(response.headers["content-disposition"]).toBe(
                `attachment; filename="certificate-${DEFAULT_CERT_ID}.pdf"`,
            );
        });
    });

    describe("given pdf generation fails", () => {
        const failingPdfHarness = () =>
            buildHarness({
                page: createPage({
                    pdf: jest.fn().mockRejectedValue(new Error("pdf crashed")),
                    $: jest.fn().mockResolvedValue(createHandle()),
                }),
            });

        it("should return the printable html fallback with a 200 status code", async () => {
            const { app } = failingPdfHarness();

            const response = await request(app).get("/certificate");

            expect(response.statusCode).toBe(200);
            expect(response.headers["content-type"]).toBe(
                "text/html; charset=utf-8",
            );
            expect(response.headers["content-disposition"]).toBe(
                `inline; filename="certificate-${DEFAULT_CERT_ID}.html"`,
            );
        });

        it("should return html that prints itself", async () => {
            const { app } = failingPdfHarness();

            const response = await request(app).get("/certificate");

            expect(response.text).toContain("window.print()");
            expect(response.text).toContain("CERTIFICATE OF");
            expect(response.text).toContain(DEFAULT_CERT_ID);
        });

        it("should close the page it opened", async () => {
            const { app, page } = failingPdfHarness();

            await request(app).get("/certificate");

            expect(page.close).toHaveBeenCalledTimes(1);
        });
    });

    describe("given the certificate element is missing", () => {
        it("should return the printable html fallback", async () => {
            const { app } = buildHarness({
                page: createPage({ $: jest.fn().mockResolvedValue(null) }),
            });

            const response = await request(app)
                .get("/certificate")
                .query({ format: "png" });

            expect(response.statusCode).toBe(200);
            expect(response.headers["content-type"]).toBe(
                "text/html; charset=utf-8",
            );
            expect(response.text).toContain("window.print()");
        });
    });

    describe("given the html fallback also fails", () => {
        const brokenQrHarness = () =>
            buildHarness({
                generateQrDataUrl: jest
                    .fn()
                    .mockRejectedValue(new Error("qr crashed")),
            });

        it("should return a 500 status code with the v1 error body", async () => {
            const { app } = brokenQrHarness();

            const response = await request(app).get("/certificate");

            expect(response.statusCode).toBe(500);
            expect(response.body).toEqual({
                status: "error",
                message: "Failed to generate certificate",
                error: "Internal server error",
            });
        });

        it("should expose the error message in development", async () => {
            const { app } = brokenQrHarness();
            const environment = config.NODE_ENV;
            config.NODE_ENV = "development";

            try {
                const response = await request(app).get("/certificate");

                expect(response.body.error).toBe("qr crashed");
            } finally {
                config.NODE_ENV = environment;
            }
        });
    });
});

describe("certificateRouter", () => {
    it("should be mountable without loading a real browser", () => {
        const router = require("../../src/modules/certificate/certificateRouter");

        expect(typeof router).toBe("function");
    });
});
