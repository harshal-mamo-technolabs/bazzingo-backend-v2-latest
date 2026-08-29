const CERTIFICATE_PLATFORM_NAME = "";

const CERTIFICATE_DEFAULTS = {
    NAME: "Christopher Taylor",
    SCORE: 126,
    CI_LOW: 119,
    CI_HIGH: 133,
    PERCENTILE: 96,
    REASONING: 127,
    VERBAL: 118,
    MEMORY: 111,
    SPEED: 124,
    CERT_ID: "BZG-2024-175839",
};

const CERTIFICATE_FORMATS = {
    PDF: "pdf",
    PNG: "png",
    JPEG: "jpeg",
    JPG: "jpg",
};

const CERTIFICATE_CONTENT_TYPES = {
    PDF: "application/pdf",
    HTML: "text/html; charset=utf-8",
};

const CERTIFICATE_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
};

const CERTIFICATE_MESSAGES = {
    GENERATION_FAILED: "Failed to generate certificate",
    INTERNAL_ERROR: "Internal server error",
    ELEMENT_NOT_FOUND: "Certificate element not found",
    launchFailed: (attempts, reason) =>
        `Failed to launch browser after ${attempts} attempts: ${reason}`,
};

const CERTIFICATE_SELECTOR = ".certificate";

const CERTIFICATE_QR_OPTIONS = { margin: 0 };

const CERTIFICATE_JPEG_QUALITY = 90;

const CERTIFICATE_PAGE = {
    WAIT_UNTIL: "networkidle0",
    MEDIA_TYPE: "screen",
    TIMEOUT_MS: 30000,
    VIEWPORT: { width: 1200, height: 800, deviceScaleFactor: 1 },
};

const CERTIFICATE_BROWSER = {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    LAUNCH_OPTIONS: {
        headless: "new",
        timeout: 60000,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        executablePath: undefined,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-extensions",
            "--disable-plugins",
            "--disable-default-apps",
            "--disable-sync",
            "--disable-translate",
            "--hide-scrollbars",
            "--mute-audio",
            "--no-default-browser-check",
            "--no-pings",
            "--password-store=basic",
            "--use-mock-keychain",
            "--single-process",
            "--disable-background-networking",
            "--disable-client-side-phishing-detection",
            "--disable-hang-monitor",
            "--disable-popup-blocking",
            "--disable-prompt-on-repost",
            "--metrics-recording-only",
            "--safebrowsing-disable-auto-update",
            "--enable-automation",
            "--disable-v8-snapshot-compression",
            "--disable-v8-snapshot",
            "--no-sandbox-and-elevated",
            "--disable-software-rasterizer",
            "--disable-background-mode",
            "--disable-ipc-flooding-protection",
            "--disable-features=TranslateUI",
            "--disable-ipc-flooding-protection",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
        ],
    },
};

const CERTIFICATE_PDF_OPTIONS = {
    printBackground: true,
    format: "A4",
    landscape: true,
    margin: {
        top: "0.3in",
        right: "0.3in",
        bottom: "0.3in",
        left: "0.3in",
    },
    preferCSSPageSize: false,
    displayHeaderFooter: false,
    scale: 0.75,
    omitBackground: false,
};

const CERTIFICATE_PRINT_SCRIPT = `
                <script>
                    window.onload = function() {
                        setTimeout(function() {
                            window.print();
                        }, 1000);
                    }
                </script>
            </head>`;

module.exports = {
    CERTIFICATE_PLATFORM_NAME,
    CERTIFICATE_DEFAULTS,
    CERTIFICATE_FORMATS,
    CERTIFICATE_CONTENT_TYPES,
    CERTIFICATE_CACHE_HEADERS,
    CERTIFICATE_MESSAGES,
    CERTIFICATE_SELECTOR,
    CERTIFICATE_QR_OPTIONS,
    CERTIFICATE_JPEG_QUALITY,
    CERTIFICATE_PAGE,
    CERTIFICATE_BROWSER,
    CERTIFICATE_PDF_OPTIONS,
    CERTIFICATE_PRINT_SCRIPT,
};
