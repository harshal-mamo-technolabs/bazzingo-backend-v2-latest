const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const { config } = require("../../config");
const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    NOTIFICATION_MESSAGES,
    NOTIFICATION_PAGINATION,
    ADMIN_MESSAGES,
} = require("../../constants");
const Admin = require("../admin/adminModel");

const clamp = (value, fallback, min, max) =>
    Math.min(Math.max(parseInt(value || String(fallback), 10), min), max);

class NotificationController {
    constructor(notificationService, logger) {
        this.notificationService = notificationService;
        this.logger = logger;
    }

    async createNotification(req, res, next) {
        const { title, body, imageUrl, websiteUrl, target } = req.body;

        this.logger.info("Request to create a notification", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            targetType: target?.type,
        });

        if (!title || !body || !target || !target.type) {
            this.logger.warn("Notification creation failed validation", {
                requestId: req.requestId,
                hasTitle: Boolean(title),
                hasBody: Boolean(body),
                hasTarget: Boolean(target),
            });
            return next(
                createHttpError(400, NOTIFICATION_MESSAGES.CREATE_REQUIRED),
            );
        }

        const notification = await this.notificationService.create({
            title,
            body,
            imageUrl,
            websiteUrl,
            target,
            createdBy: req.admin._id,
        });

        void this.notificationService.dispatchPush(notification);

        this.logger.info(
            "Notification created, push dispatching in background",
            {
                requestId: req.requestId,
                notificationId: String(notification._id),
            },
        );

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.CREATED,
            data: { notification },
        });
    }

    async listNotifications(req, res) {
        const page = clamp(
            req.query.page,
            NOTIFICATION_PAGINATION.DEFAULT_PAGE,
            1,
            Number.MAX_SAFE_INTEGER,
        );
        const limit = clamp(
            req.query.limit,
            NOTIFICATION_PAGINATION.DEFAULT_LIMIT,
            NOTIFICATION_PAGINATION.MIN_LIMIT,
            NOTIFICATION_PAGINATION.ADMIN_MAX_LIMIT,
        );

        this.logger.info("Request to list the notifications", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            page,
            limit,
        });

        const { items, total } = await this.notificationService.list({
            page,
            limit,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.LISTED,
            data: { items, total, page, limit },
        });
    }

    async getNotification(req, res, next) {
        this.logger.info("Request to read a notification", {
            requestId: req.requestId,
            notificationId: req.params.id,
        });

        const notification = await this.notificationService.findById(
            req.params.id,
        );

        if (!notification) {
            this.logger.warn("Notification not found", {
                requestId: req.requestId,
                notificationId: req.params.id,
            });
            return next(createHttpError(404, NOTIFICATION_MESSAGES.NOT_FOUND));
        }

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.FETCHED,
            data: { notification },
        });
    }

    async updateNotification(req, res, next) {
        this.logger.info("Request to update a notification", {
            requestId: req.requestId,
            notificationId: req.params.id,
        });

        const notification = await this.notificationService.update(
            req.params.id,
            req.body,
        );

        if (!notification) {
            this.logger.warn("Notification to update was not found", {
                requestId: req.requestId,
                notificationId: req.params.id,
            });
            return next(createHttpError(404, NOTIFICATION_MESSAGES.NOT_FOUND));
        }

        this.logger.info("Notification updated", {
            requestId: req.requestId,
            notificationId: req.params.id,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.UPDATED,
            data: { notification },
        });
    }

    async deleteNotification(req, res, next) {
        this.logger.info("Request to delete a notification", {
            requestId: req.requestId,
            notificationId: req.params.id,
        });

        const notification = await this.notificationService.delete(
            req.params.id,
        );

        if (!notification) {
            this.logger.warn("Notification to delete was not found", {
                requestId: req.requestId,
                notificationId: req.params.id,
            });
            return next(createHttpError(404, NOTIFICATION_MESSAGES.NOT_FOUND));
        }

        this.logger.info("Notification deleted", {
            requestId: req.requestId,
            notificationId: req.params.id,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.DELETED,
        });
    }

    async fetchMyNotifications(req, res) {
        const page = clamp(
            req.query.page,
            NOTIFICATION_PAGINATION.DEFAULT_PAGE,
            1,
            Number.MAX_SAFE_INTEGER,
        );
        const limit = clamp(
            req.query.limit,
            NOTIFICATION_PAGINATION.DEFAULT_LIMIT,
            NOTIFICATION_PAGINATION.MIN_LIMIT,
            NOTIFICATION_PAGINATION.USER_MAX_LIMIT,
        );

        this.logger.info("Request to read the user notifications", {
            requestId: req.requestId,
            userId: String(req.user._id),
            page,
            limit,
        });

        const { unread, read } = await this.notificationService.findForUser(
            req.user,
        );

        const ordered = [...unread, ...read];
        const skip = (page - 1) * limit;

        this.logger.info("User notifications sent", {
            requestId: req.requestId,
            userId: String(req.user._id),
            total: ordered.length,
            unreadCount: unread.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.LISTED,
            data: {
                items: ordered.slice(skip, skip + limit),
                total: ordered.length,
                unreadCount: unread.length,
                page,
                limit,
            },
        });
    }

    async markAsRead(req, res, next) {
        const { id } = req.params;

        this.logger.info("Request to acknowledge a notification", {
            requestId: req.requestId,
            userId: String(req.user._id),
            notificationId: id,
        });

        const notification = await this.notificationService.findById(id);

        if (!notification) {
            this.logger.warn("Notification to acknowledge was not found", {
                requestId: req.requestId,
                notificationId: id,
            });
            return next(createHttpError(404, NOTIFICATION_MESSAGES.NOT_FOUND));
        }

        const receipt = await this.notificationService.markAsRead({
            userId: req.user._id,
            notificationId: id,
        });

        this.logger.info("Notification acknowledged", {
            requestId: req.requestId,
            userId: String(req.user._id),
            notificationId: id,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.MARKED_READ,
            data: { receipt },
        });
    }

    async testNotification(req, res) {
        this.logger.info("Notification test endpoint called", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.TEST_OK,
            data: {
                timestamp: new Date().toISOString(),
                adminId: req.admin?._id,
                body: req.body,
            },
        });
    }

    async minimalTest(req, res) {
        this.logger.info("Notification minimal test endpoint called", {
            requestId: req.requestId,
        });

        return res.status(200).json({
            status: RESPONSE_STATUS.SUCCESS,
            message: NOTIFICATION_MESSAGES.MINIMAL_OK,
            timestamp: new Date().toISOString(),
            body: req.body,
        });
    }

    async debugAdminMiddleware(req, res) {
        this.logger.info("Notification admin debug endpoint called", {
            requestId: req.requestId,
        });

        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                status: RESPONSE_STATUS.ERROR,
                message: NOTIFICATION_MESSAGES.DEBUG_NO_TOKEN,
                step: "auth-header-check",
            });
        }

        try {
            const decoded = jwt.verify(
                authHeader.split(" ")[1],
                config.JWT_SECRET,
            );
            const admin = await Admin.findById(decoded.adminId);

            if (!admin || !admin.isActive) {
                return res.status(401).json({
                    status: RESPONSE_STATUS.ERROR,
                    message: ADMIN_MESSAGES.INVALID_ADMIN,
                    step: "admin-validation",
                });
            }

            return res.status(200).json({
                status: RESPONSE_STATUS.SUCCESS,
                message: NOTIFICATION_MESSAGES.DEBUG_OK,
                adminId: admin._id,
                adminEmail: admin.email,
                adminRole: admin.role,
            });
        } catch (err) {
            this.logger.error("Notification admin debug failed", {
                requestId: req.requestId,
                message: err.message,
            });

            return res.status(500).json({
                status: RESPONSE_STATUS.ERROR,
                message: NOTIFICATION_MESSAGES.DEBUG_FAILED,
                error: err.message,
                step: "error-catch",
            });
        }
    }
}

module.exports = { NotificationController };
