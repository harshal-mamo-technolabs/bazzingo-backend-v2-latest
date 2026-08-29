const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const { RESPONSE_STATUS, PUSH_MESSAGES } = require("../../constants");

class PushController {
    constructor(pushService, logger) {
        this.pushService = pushService;
        this.logger = logger;
    }

    async subscribe(req, res, next) {
        const { subscription, deviceId } = req.body;
        const userId = req.user._id;

        this.logger.info("Request to subscribe to push notifications", {
            requestId: req.requestId,
            userId: String(userId),
            deviceId,
        });

        if (!subscription || !subscription.endpoint || !subscription.keys) {
            this.logger.warn("Push subscription payload was invalid", {
                requestId: req.requestId,
                userId: String(userId),
                hasSubscription: Boolean(subscription),
                hasEndpoint: Boolean(subscription?.endpoint),
                hasKeys: Boolean(subscription?.keys),
            });
            return next(createHttpError(400, PUSH_MESSAGES.INVALID_PAYLOAD));
        }

        const doc = await this.pushService.upsert({
            userId,
            endpoint: subscription.endpoint,
            keys: subscription.keys,
            userAgent: req.headers["user-agent"],
            deviceId,
        });

        this.logger.info("Push subscription stored", {
            requestId: req.requestId,
            userId: String(userId),
            subscriptionId: String(doc._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: PUSH_MESSAGES.SUBSCRIBED,
            data: {
                subscription: {
                    id: doc._id,
                    endpoint: doc.endpoint,
                    isActive: doc.isActive,
                    createdAt: doc.createdAt,
                },
            },
        });
    }

    async unsubscribe(req, res, next) {
        const { endpoint } = req.body;
        const userId = req.user._id;

        this.logger.info("Request to unsubscribe from push notifications", {
            requestId: req.requestId,
            userId: String(userId),
            endpoint,
        });

        if (!endpoint) {
            this.logger.warn("Push unsubscribe is missing the endpoint", {
                requestId: req.requestId,
                userId: String(userId),
            });
            return next(createHttpError(400, PUSH_MESSAGES.ENDPOINT_REQUIRED));
        }

        await this.pushService.deactivate({ userId, endpoint });

        this.logger.info("Push subscription deactivated", {
            requestId: req.requestId,
            userId: String(userId),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: PUSH_MESSAGES.UNSUBSCRIBED,
        });
    }

    async getPushSubscriptionStatus(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the push subscription status", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const subscription = await this.pushService.findActiveByUserId(userId);

        if (!subscription) {
            this.logger.info("No active push subscription", {
                requestId: req.requestId,
                userId: String(userId),
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: PUSH_MESSAGES.NO_SUBSCRIPTION,
                data: { isSubscribed: false, subscription: null },
            });
        }

        this.logger.info("Active push subscription found", {
            requestId: req.requestId,
            userId: String(userId),
            subscriptionId: String(subscription._id),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: PUSH_MESSAGES.SUBSCRIPTION_FOUND,
            data: {
                isSubscribed: true,
                subscription: {
                    id: subscription._id,
                    endpoint: subscription.endpoint,
                    userId: subscription.userId,
                    isActive: subscription.isActive,
                    createdAt: subscription.createdAt,
                    updatedAt: subscription.updatedAt,
                    hasKeys: Boolean(
                        subscription.keys &&
                        subscription.keys.p256dh &&
                        subscription.keys.auth,
                    ),
                },
            },
        });
    }
}

module.exports = { PushController };
