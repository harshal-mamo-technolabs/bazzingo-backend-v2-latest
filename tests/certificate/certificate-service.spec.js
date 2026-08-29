const logger = require("../../src/config/logger");
const {
    CertificateService,
} = require("../../src/modules/certificate/certificateService");

const PDF_BUFFER = Buffer.from("%PDF-1.4 certificate");
const QR_DATA_URL = "data:image/png;base64,QRCODE";

const certificateData = {
    name: "Ada Lovelace",
    score: 141,
    ciLow: 134,
    ciHigh: 148,
    percentile: 99,
    reasoning: 145,
    verbal: 138,
    memory: 132,
    speed: 140,
    certId: "BZG-2026-000001",
};

const createPage = () => ({
    setDefaultTimeout: jest.fn(),
    setViewport: jest.fn().mockResolvedValue(undefined),
    setContent: jest.fn().mockResolvedValue(undefined),
    emulateMediaType: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(PDF_BUFFER),
    $: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
});

const createBrowser = (overrides = {}) => ({
    isConnected: jest.fn().mockReturnValue(true),
    newPage: jest.fn(async () => createPage()),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

const buildService = (launchBrowser) =>
    new CertificateService(logger, {
        launchBrowser,
        generateQrDataUrl: jest.fn().mockResolvedValue(QR_DATA_URL),
    });

describe("CertificateService browser pool", () => {
    it("should launch the browser only once for repeated generations", async () => {
        const launchBrowser = jest.fn().mockResolvedValue(createBrowser());
        const service = buildService(launchBrowser);

        await service.generate(certificateData, "pdf");
        await service.generate(certificateData, "pdf");

        expect(launchBrowser).toHaveBeenCalledTimes(1);
    });

    it("should share one launch between concurrent generations", async () => {
        const launchBrowser = jest.fn(
            () =>
                new Promise((resolve) =>
                    setTimeout(() => resolve(createBrowser()), 20),
                ),
        );
        const service = buildService(launchBrowser);

        await Promise.all([
            service.generate(certificateData, "pdf"),
            service.generate(certificateData, "pdf"),
        ]);

        expect(launchBrowser).toHaveBeenCalledTimes(1);
    });

    it("should relaunch when the pooled browser is disconnected", async () => {
        const disconnected = createBrowser({
            isConnected: jest.fn().mockReturnValue(false),
        });
        const launchBrowser = jest
            .fn()
            .mockResolvedValueOnce(disconnected)
            .mockResolvedValueOnce(createBrowser());
        const service = buildService(launchBrowser);

        await service.generate(certificateData, "pdf");
        await service.generate(certificateData, "pdf");

        expect(launchBrowser).toHaveBeenCalledTimes(2);
    });

    it("should retry a failing launch until it succeeds", async () => {
        const launchBrowser = jest
            .fn()
            .mockRejectedValueOnce(new Error("boom"))
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce(createBrowser());
        const service = buildService(launchBrowser);

        const result = await service.generate(certificateData, "pdf");

        expect(launchBrowser).toHaveBeenCalledTimes(3);
        expect(result.body).toEqual(PDF_BUFFER);
    }, 15000);

    it("should give up after three failed launches", async () => {
        const launchBrowser = jest.fn().mockRejectedValue(new Error("boom"));
        const service = buildService(launchBrowser);

        await expect(service.generate(certificateData, "pdf")).rejects.toThrow(
            "Failed to launch browser after 3 attempts: boom",
        );
        expect(launchBrowser).toHaveBeenCalledTimes(3);
    }, 15000);
});

describe("CertificateService.cleanup", () => {
    it("should close the pooled browser", async () => {
        const browser = createBrowser();
        const service = buildService(jest.fn().mockResolvedValue(browser));

        await service.generate(certificateData, "pdf");
        await service.cleanup();

        expect(browser.close).toHaveBeenCalledTimes(1);
    });

    it("should drop the pooled browser so the next request relaunches", async () => {
        const launchBrowser = jest.fn(async () => createBrowser());
        const service = buildService(launchBrowser);

        await service.generate(certificateData, "pdf");
        await service.cleanup();
        await service.generate(certificateData, "pdf");

        expect(launchBrowser).toHaveBeenCalledTimes(2);
    });

    it("should do nothing when no browser was ever launched", async () => {
        const launchBrowser = jest.fn();
        const service = buildService(launchBrowser);

        await expect(service.cleanup()).resolves.toBeUndefined();
        expect(launchBrowser).not.toHaveBeenCalled();
    });

    it("should swallow a failing close", async () => {
        const browser = createBrowser({
            close: jest.fn().mockRejectedValue(new Error("close crashed")),
        });
        const service = buildService(jest.fn().mockResolvedValue(browser));

        await service.generate(certificateData, "pdf");

        await expect(service.cleanup()).resolves.toBeUndefined();
    });
});
