const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const { RESPONSE_STATUS, DASHBOARD_MESSAGES } = require("../../constants");

class DashboardController {
    constructor(dashboardService, logger) {
        this.dashboardService = dashboardService;
        this.logger = logger;
    }

    async getDashboardStats(req, res, next) {
        const userId = req.user._id;

        this.logger.info("Request for the dashboard stats", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const stats = await this.dashboardService.getStats(userId);

        if (!stats) {
            this.logger.warn("Dashboard stats user is missing", {
                requestId: req.requestId,
                userId: String(userId),
            });

            return next(
                createHttpError(404, DASHBOARD_MESSAGES.USER_NOT_FOUND),
            );
        }

        this.logger.info("Dashboard stats returned", {
            requestId: req.requestId,
            userId: String(userId),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: DASHBOARD_MESSAGES.STATS,
            data: stats,
        });
    }

    async getRecentActivity(req, res, next) {
        const userId = req.user._id;

        this.logger.info("Request for the recent activity", {
            requestId: req.requestId,
            userId: String(userId),
        });

        try {
            const data = await this.dashboardService.getRecentActivity(userId);

            this.logger.info("Recent activity returned", {
                requestId: req.requestId,
                userId: String(userId),
                total: data.total,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: DASHBOARD_MESSAGES.RECENT_ACTIVITY,
                data,
            });
        } catch (err) {
            this.logger.error("Failed to retrieve the recent activity", {
                requestId: req.requestId,
                userId: String(userId),
                message: err.message,
                stack: err.stack,
            });

            return next(
                createHttpError(500, DASHBOARD_MESSAGES.RECENT_ACTIVITY_FAILED),
            );
        }
    }

    async getDailyStreakStatus(req, res, next) {
        const userId = req.user._id;

        this.logger.info("Request for the daily streak status", {
            requestId: req.requestId,
            userId: String(userId),
        });

        try {
            const data =
                await this.dashboardService.getDailyStreakStatus(userId);

            this.logger.info("Daily streak status returned", {
                requestId: req.requestId,
                userId: String(userId),
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: DASHBOARD_MESSAGES.DAILY_STREAK_STATUS,
                data,
            });
        } catch (err) {
            this.logger.error("Failed to retrieve the daily streak status", {
                requestId: req.requestId,
                userId: String(userId),
                message: err.message,
                stack: err.stack,
            });

            return next(
                createHttpError(
                    500,
                    DASHBOARD_MESSAGES.DAILY_STREAK_STATUS_FAILED,
                ),
            );
        }
    }
}

module.exports = { DashboardController };
