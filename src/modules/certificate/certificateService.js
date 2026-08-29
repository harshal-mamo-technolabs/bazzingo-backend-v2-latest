const {
    CERTIFICATE_BROWSER,
    CERTIFICATE_FORMATS,
    CERTIFICATE_JPEG_QUALITY,
    CERTIFICATE_MESSAGES,
    CERTIFICATE_PAGE,
    CERTIFICATE_PDF_OPTIONS,
    CERTIFICATE_PLATFORM_NAME,
    CERTIFICATE_PRINT_SCRIPT,
    CERTIFICATE_QR_OPTIONS,
    CERTIFICATE_SELECTOR,
} = require("../../constants");

const certificateHTML = ({
    name,
    score,
    ciLow,
    ciHigh,
    percentile,
    reasoning,
    verbal,
    memory,
    speed,
    certId,
    qrDataUrl,
}) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Certificate</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Satisfy&display=swap" rel="stylesheet">
<style>
  :root{
    --navy:#1b2f57; --navy-2:#22345d; --muted:#3b4d76;
    --paper-1:#fdfaf7; --paper-2:#f7f2ed; --accent:#f0462d;
    --chip-orange-1:#f47a46; --chip-orange-2:#d9452f;
    --chip-magenta-1:#b24fb2; --chip-magenta-2:#7c308c;
    --chip-purple-1:#7a3ea2; --chip-purple-2:#572c7e;
    --chip-blue-1:#4a73d0; --chip-blue-2:#2a50a7;
  }
  html,body{margin:0;height:100%}
  body{
    display:flex;align-items:center;justify-content:center;min-height:100vh;
    background: white;
    font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    padding: 20px;
    box-sizing: border-box;
  }
  @media (max-width: 1000px) {
    body { padding: 10px; }
    .certificate {
      width: 100% !important;
      max-width: 100% !important;
      padding: 40px 30px !important;
    }
  }
  .certificate{
    width:1000px;max-width:100%;background:linear-gradient(180deg,var(--paper-1),var(--paper-2));
    border:10px solid var(--navy-2); border-radius:4px; padding:40px 50px; box-sizing:border-box;
    position:relative; box-shadow:0 12px 30px rgba(0,0,0,.25);
    margin:0 auto;
  }
  .certificate::before{content:"";position:absolute;inset:10px;border:3px solid #c7b6ac;border-radius:2px;pointer-events:none;}
  .logo{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;}
  .logo svg{width:30px;height:30px}
  .logo span{color:var(--navy);font-weight:800;letter-spacing:.10em;font-size:20px;}
  .title{text-align:center;color:var(--navy);font-weight:900;font-size:40px;letter-spacing:.06em;line-height:1.1;margin:16px 0 24px;}
  .subtitle,.midtext,.meta{text-align:center;color:var(--muted)}
  .subtitle{font-size:18px;margin-bottom:6px;}
  .name{text-align:center;color:var(--navy);font-weight:800;font-size:40px;margin:4px 0 8px;}
  .midtext{font-size:18px;margin-bottom:10px;}
  .score{text-align:center;color:var(--accent);font-weight:900;font-size:100px;line-height:1;margin:0;letter-spacing:.01em;}
  .meta{font-size:15px;margin-top:8px;line-height:1.3;}
  .score-row{display:flex;justify-content:center;gap:16px;margin:30px 0 24px;}
  .pill{width:140px;border-radius:10px;padding:12px 10px 14px;text-align:center;color:#fff;box-shadow:0 8px 16px rgba(0,0,0,.18);}
  .pill .label{font-size:13px;font-weight:700;letter-spacing:.02em;margin-bottom:6px;opacity:.95;}
  .pill .num{font-size:28px;font-weight:800;line-height:1;letter-spacing:.01em;}
  .reasoning{background:linear-gradient(180deg,var(--chip-orange-1),var(--chip-orange-2))}
  .verbal{background:linear-gradient(180deg,var(--chip-magenta-1),var(--chip-magenta-2))}
  .memory{background:linear-gradient(180deg,var(--chip-purple-1),var(--chip-purple-2))}
  .speed{background:linear-gradient(180deg,var(--chip-blue-1),var(--chip-blue-2))}
  .footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:6px;}
  .qr{display:flex;align-items:center;gap:16px;}
  .qr img{width:80px;height:80px;}
  .qr-text{font-size:12px;color:#2b3d65;line-height:1.4;max-width:320px;}
  .qr-text b{font-weight:800;color:var(--navy);}
  .signature{text-align:right;}
  .signature-name{font-family:'Satisfy',cursive;font-size:26px;color:var(--navy);margin:0 0 6px;}
  .signature-role{font-size:13px;color:#2b3d65;}
  /* Print styles for optimal zoom level */
  @page{
    size: A4 landscape;
    margin: 0.3in;
  }
  @media print {
    body {
      margin: 0;
      padding: 0;
      background: white !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .certificate {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      margin: 0 !important;
      padding: 20px 25px !important;
      box-sizing: border-box;
      transform: scale(0.8);
      transform-origin: top center;
      background: linear-gradient(180deg,var(--paper-1),var(--paper-2)) !important;
    }
  }
</style>
</head>
<body>
  <div class="certificate">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="#f46a3a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8.2 8.5a3 3 0 0 1 4.3-2.7 3 3 0 0 1 5 2.2 3 3 0 0 1-1.7 2.6M9 12a3 3 0 1 0 0 6h2.5"/>
        <path d="M12 4.8v14.4M15.7 10.8h2.1"/>
      </svg>
      <span>${CERTIFICATE_PLATFORM_NAME}</span>
    </div>

    <div class="title">CERTIFICATE OF<br>IQ ACHIEVEMENT</div>

    <div class="subtitle">This certifies that</div>
    <div class="name">${name}</div>
    <div class="midtext">has achieved a Full Scale IQ score of</div>

    <p class="score">${score}</p>
    <div class="meta">
      Confidence Interval ${ciLow}–${ciHigh}<br>
      Percentile Rank ${percentile}
    </div>

    <div class="score-row">
      <div class="pill reasoning"><div class="label">Reasoning</div><div class="num">${reasoning}</div></div>
      <div class="pill verbal"><div class="label">Verbal</div><div class="num">${verbal}</div></div>
        <div class="pill memory"><div class="label">Memory</div><div class="num">${memory}</div></div>
        <div class="pill speed"><div class="label">Processing<br>Speed</div><div class="num">${speed}</div></div>
    </div>

    <div class="footer">
      <div class="qr">
        <img src="${qrDataUrl}" alt="QR">
        <div class="qr-text">
          <b>Certificate ID</b> ${certId}<br>
          This score is based on a normative sample with a mean of 100 and a standard deviation of 15.
        </div>
      </div>
      <div class="signature">
        <p class="signature-name">Daniel Foster</p>
        <div class="signature-role">Chief Psychologist</div>
      </div>
    </div>
  </div>
</body>
</html>`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CertificateService {
    constructor(logger, { launchBrowser, generateQrDataUrl }) {
        this.logger = logger;
        this.launchBrowser = launchBrowser;
        this.generateQrDataUrl = generateQrDataUrl;
        this.browser = null;
        this.browserLaunch = null;
    }

    async buildHtml(data) {
        this.logger.info("Building the certificate html", {
            certId: data.certId,
        });

        const qrDataUrl = await this.generateQrDataUrl(
            data.certId,
            CERTIFICATE_QR_OPTIONS,
        );

        this.logger.info("Certificate html built", { certId: data.certId });

        return certificateHTML({ ...data, qrDataUrl });
    }

    async buildPrintableHtml(data) {
        this.logger.info("Building the printable certificate html", {
            certId: data.certId,
        });

        const html = await this.buildHtml(data);

        this.logger.info("Printable certificate html built", {
            certId: data.certId,
        });

        return html.replace("</head>", CERTIFICATE_PRINT_SCRIPT);
    }

    async getBrowser() {
        if (this.browser && this.browser.isConnected()) {
            return this.browser;
        }

        if (this.browserLaunch) {
            return await this.browserLaunch;
        }

        this.logger.info("Launching the certificate browser");
        this.browserLaunch = this.launchBrowser(
            CERTIFICATE_BROWSER.LAUNCH_OPTIONS,
        );

        try {
            this.browser = await this.browserLaunch;
            this.browserLaunch = null;

            this.logger.info("Certificate browser launched");

            return this.browser;
        } catch (error) {
            this.browserLaunch = null;

            this.logger.error("Certificate browser launch failed", {
                message: error.message,
            });

            throw error;
        }
    }

    async openPage() {
        this.logger.info("Opening a certificate page");

        for (
            let attempt = 1;
            attempt <= CERTIFICATE_BROWSER.MAX_RETRIES;
            attempt += 1
        ) {
            try {
                const browser = await this.getBrowser();
                const page = await browser.newPage();

                this.logger.info("Certificate page opened", { attempt });

                return page;
            } catch (error) {
                this.logger.error("Opening a certificate page failed", {
                    attempt,
                    maxRetries: CERTIFICATE_BROWSER.MAX_RETRIES,
                    message: error.message,
                });

                if (attempt >= CERTIFICATE_BROWSER.MAX_RETRIES) {
                    throw new Error(
                        CERTIFICATE_MESSAGES.launchFailed(
                            CERTIFICATE_BROWSER.MAX_RETRIES,
                            error.message,
                        ),
                    );
                }

                this.browser = null;
                await wait(CERTIFICATE_BROWSER.RETRY_DELAY_MS);
            }
        }
    }

    async renderPdf(page, certId) {
        this.logger.info("Printing the certificate to pdf", { certId });

        const body = await page.pdf(CERTIFICATE_PDF_OPTIONS);

        this.logger.info("Certificate pdf printed", { certId });

        return { body, filename: `certificate-${certId}.pdf` };
    }

    async renderImage(page, certId, format) {
        this.logger.info("Screenshotting the certificate", { certId, format });

        const handle = await page.$(CERTIFICATE_SELECTOR);

        if (!handle) {
            this.logger.error("The certificate element was not rendered", {
                certId,
                format,
            });

            throw new Error(CERTIFICATE_MESSAGES.ELEMENT_NOT_FOUND);
        }

        const body = await handle.screenshot({
            type: format,
            quality:
                format === CERTIFICATE_FORMATS.JPEG
                    ? CERTIFICATE_JPEG_QUALITY
                    : undefined,
            omitBackground: false,
        });

        const extension =
            format === CERTIFICATE_FORMATS.JPEG
                ? CERTIFICATE_FORMATS.JPG
                : CERTIFICATE_FORMATS.PNG;

        this.logger.info("Certificate screenshot taken", { certId, format });

        return { body, filename: `certificate-${certId}.${extension}` };
    }

    async generate(data, format) {
        this.logger.info("Generating a certificate", {
            certId: data.certId,
            format,
        });

        const html = await this.buildHtml(data);
        let page = null;

        try {
            page = await this.openPage();
            page.setDefaultTimeout(CERTIFICATE_PAGE.TIMEOUT_MS);
            await page.setViewport(CERTIFICATE_PAGE.VIEWPORT);
            await page.setContent(html, {
                waitUntil: CERTIFICATE_PAGE.WAIT_UNTIL,
            });
            await page.emulateMediaType(CERTIFICATE_PAGE.MEDIA_TYPE);

            const result =
                format === CERTIFICATE_FORMATS.PDF
                    ? await this.renderPdf(page, data.certId)
                    : await this.renderImage(page, data.certId, format);

            await page.close();
            page = null;

            this.logger.info("Certificate generated", {
                certId: data.certId,
                format,
                filename: result.filename,
            });

            return result;
        } catch (error) {
            this.logger.error("Certificate generation failed", {
                certId: data.certId,
                format,
                message: error.message,
            });

            if (page) {
                try {
                    await page.close();
                } catch (pageError) {
                    this.logger.warn("Closing the certificate page failed", {
                        certId: data.certId,
                        message: pageError.message,
                    });
                }
            }

            throw error;
        }
    }

    async cleanup() {
        if (!this.browser) {
            return;
        }

        this.logger.info("Closing the certificate browser");

        const browser = this.browser;
        this.browser = null;

        try {
            await browser.close();

            this.logger.info("Certificate browser closed");
        } catch (error) {
            this.logger.warn("Graceful certificate browser close failed", {
                message: error.message,
            });

            try {
                if (browser.process && browser.process.kill) {
                    browser.process.kill("SIGKILL");
                }
            } catch (killError) {
                this.logger.warn("Force certificate browser close failed", {
                    message: killError.message,
                });
            }
        }
    }
}

module.exports = { CertificateService };
