const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const requireAdmin = require("../../common/middlewares/requireAdmin");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { sendWebPush } = require("../../common/utils/webPush");
const { PushService } = require("../push/pushService");
const { NotificationController } = require("./notificationController");
const { NotificationService } = require("./notificationService");

const router = express.Router();

const notificationController = new NotificationController(
    new NotificationService(logger, new PushService(logger), sendWebPush),
    logger,
);

const handler = (method) =>
    asyncWrapper(notificationController[method].bind(notificationController));

router
    .route("/my-notifications")
    .get(requireAuth, handler("fetchMyNotifications"));

router.route("/:id/acknowledge").post(requireAuth, handler("markAsRead"));

router.route("/minimal").post(handler("minimalTest"));

router.route("/debug-admin").post(handler("debugAdminMiddleware"));

router.route("/test").post(requireAdmin(), handler("testNotification"));

router
    .route("/")
    .get(requireAdmin(), handler("listNotifications"))
    .post(requireAdmin(), handler("createNotification"));

router
    .route("/:id")
    .get(requireAdmin(), handler("getNotification"))
    .put(requireAdmin(), handler("updateNotification"))
    .delete(requireAdmin(), handler("deleteNotification"));

module.exports = router;
