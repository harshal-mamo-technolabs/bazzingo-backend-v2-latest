const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const {
    allowHelpScoutIframe,
} = require("../../common/middlewares/allowHelpScoutIframe");
const {
    requireHelpScoutAppAuth,
} = require("../../common/middlewares/requireHelpScoutAppAuth");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { KlaviyoService } = require("../klaviyo/klaviyoService");
const { HelpscoutController } = require("./helpscoutController");
const { HelpscoutService } = require("./helpscoutService");

const router = express.Router();

const helpscoutController = new HelpscoutController(
    new HelpscoutService(logger),
    new KlaviyoService(logger),
    logger,
);

const handler = (method) =>
    asyncWrapper(helpscoutController[method].bind(helpscoutController));

router.route("/user-signature").get(requireAuth, handler("getUserSignature"));
router
    .route("/profile-sidebar")
    .get(allowHelpScoutIframe, handler("renderProfileSidebar"));
router
    .route("/klaviyo-profile")
    .get(requireHelpScoutAppAuth, handler("getKlaviyoProfile"));

module.exports = router;
