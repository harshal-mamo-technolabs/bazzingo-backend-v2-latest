const express = require("express");
const logger = require("../../config/logger");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { CertificateController } = require("./certificateController");
const { CertificateService } = require("./certificateService");

const launchBrowser = (options) => require("puppeteer").launch(options);

const generateQrDataUrl = (text, options) =>
    require("qrcode").toDataURL(text, options);

const certificateService = new CertificateService(logger, {
    launchBrowser,
    generateQrDataUrl,
});

const router = express.Router();

const certificateController = new CertificateController(
    certificateService,
    logger,
);

const handler = (method) =>
    asyncWrapper(certificateController[method].bind(certificateController));

router.route("/").get(handler("getCertificate"));

module.exports = router;
module.exports.certificateService = certificateService;
