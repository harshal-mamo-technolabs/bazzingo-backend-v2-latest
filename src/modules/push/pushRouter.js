const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { PushController } = require("./pushController");
const { PushService } = require("./pushService");

const router = express.Router();

const pushController = new PushController(new PushService(logger), logger);

const handler = (method) =>
    asyncWrapper(pushController[method].bind(pushController));

router.route("/subscribe").post(requireAuth, handler("subscribe"));

router.route("/unsubscribe").post(requireAuth, handler("unsubscribe"));

router.route("/status").get(requireAuth, handler("getPushSubscriptionStatus"));

module.exports = router;
