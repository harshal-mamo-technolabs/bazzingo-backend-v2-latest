const express = require("express");
const logger = require("../../config/logger");
const { config } = require("../../config");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { TranslateController } = require("./translateController");
const { TranslateService } = require("./translateService");

const router = express.Router();

const translateController = new TranslateController(
    new TranslateService(
        logger,
        (url, options) => globalThis.fetch(url, options),
        config.GOOGLE_TRANSLATE_KEY,
    ),
    logger,
);

const handler = (method) =>
    asyncWrapper(translateController[method].bind(translateController));

router.route("/").post(handler("translate"));

module.exports = router;
