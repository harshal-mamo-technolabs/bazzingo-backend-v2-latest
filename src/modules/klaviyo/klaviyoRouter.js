const express = require("express");
const logger = require("../../config/logger");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { KlaviyoController } = require("./klaviyoController");
const { KlaviyoService } = require("./klaviyoService");

const router = express.Router();

const klaviyoController = new KlaviyoController(
    new KlaviyoService(logger),
    logger,
);

const handler = (method) =>
    asyncWrapper(klaviyoController[method].bind(klaviyoController));

router.route("/profiles").get(handler("getAllProfiles"));
router.route("/events").get(handler("getAllEvents"));
router.route("/metrics").get(handler("getAllMetrics"));

module.exports = router;
