const { config } = require("../../config");
const {
    CERTIFICATE_CACHE_HEADERS,
    CERTIFICATE_CONTENT_TYPES,
    CERTIFICATE_DEFAULTS,
    CERTIFICATE_FORMATS,
    CERTIFICATE_MESSAGES,
    RESPONSE_STATUS,
} = require("../../constants");

const IMAGE_FORMATS = [
    CERTIFICATE_FORMATS.PNG,
    CERTIFICATE_FORMATS.JPEG,
    CERTIFICATE_FORMATS.JPG,
];

const resolveFormat = (requested) => {
    const format = String(requested || CERTIFICATE_FORMATS.PDF).toLowerCase();

    if (!IMAGE_FORMATS.includes(format)) {
        return CERTIFICATE_FORMATS.PDF;
    }

    return format === CERTIFICATE_FORMATS.JPG
        ? CERTIFICATE_FORMATS.JPEG
        : format;
};

const certificateDataFrom = (query) => ({
    name: query.name || CERTIFICATE_DEFAULTS.NAME,
    score: query.score || CERTIFICATE_DEFAULTS.SCORE,
    ciLow: query.ciLow || CERTIFICATE_DEFAULTS.CI_LOW,
    ciHigh: query.ciHigh || CERTIFICATE_DEFAULTS.CI_HIGH,
    percentile: query.percentile || CERTIFICATE_DEFAULTS.PERCENTILE,
    reasoning: query.reasoning || CERTIFICATE_DEFAULTS.REASONING,
    verbal: query.verbal || CERTIFICATE_DEFAULTS.VERBAL,
    memory: query.memory || CERTIFICATE_DEFAULTS.MEMORY,
    speed: query.speed || CERTIFICATE_DEFAULTS.SPEED,
    certId: query.certId || CERTIFICATE_DEFAULTS.CERT_ID,
});

class CertificateController {
    constructor(certificateService, logger) {
        this.certificateService = certificateService;
        this.logger = logger;
    }

    async getCertificate(req, res) {
        const data = certificateDataFrom(req.query);
        const format = resolveFormat(req.query.format);

        this.logger.info("Request to generate a certificate", {
            requestId: req.requestId,
            certId: data.certId,
            format,
        });

        try {
            const { body, filename } = await this.certificateService.generate(
                data,
                format,
            );

            res.setHeader("Content-Type", CERTIFICATE_CONTENT_TYPES.PDF);
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${filename}"`,
            );
            Object.entries(CERTIFICATE_CACHE_HEADERS).forEach(
                ([header, value]) => res.setHeader(header, value),
            );

            this.logger.info("Certificate sent", {
                requestId: req.requestId,
                certId: data.certId,
                format,
                filename,
            });

            return res.send(body);
        } catch (error) {
            this.logger.error("Certificate generation failed", {
                requestId: req.requestId,
                certId: data.certId,
                format,
                message: error.message,
                stack: error.stack,
            });

            try {
                const html =
                    await this.certificateService.buildPrintableHtml(data);

                res.setHeader("Content-Type", CERTIFICATE_CONTENT_TYPES.HTML);
                res.setHeader(
                    "Content-Disposition",
                    `inline; filename="certificate-${data.certId}.html"`,
                );

                this.logger.info("Printable certificate html sent", {
                    requestId: req.requestId,
                    certId: data.certId,
                });

                return res.send(html);
            } catch (fallbackError) {
                this.logger.error("The certificate html fallback failed", {
                    requestId: req.requestId,
                    certId: data.certId,
                    message: fallbackError.message,
                    stack: fallbackError.stack,
                });
            }

            return res.status(500).json({
                status: RESPONSE_STATUS.ERROR,
                message: CERTIFICATE_MESSAGES.GENERATION_FAILED,
                error:
                    config.NODE_ENV === "development"
                        ? error && error.message
                            ? error.message
                            : String(error)
                        : CERTIFICATE_MESSAGES.INTERNAL_ERROR,
            });
        }
    }
}

module.exports = { CertificateController };
