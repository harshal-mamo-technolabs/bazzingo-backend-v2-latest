const PushSubscription = require("./pushSubscriptionModel");

class PushService {
    constructor(logger) {
        this.logger = logger;
    }

    async findActiveByUserId(userId) {
        this.logger.info("Reading the active push subscription", {
            userId: String(userId),
        });

        return await PushSubscription.findOne({
            userId,
            isActive: true,
        }).lean();
    }

    async upsert({ userId, endpoint, keys, userAgent, deviceId }) {
        this.logger.info("Saving a push subscription", {
            userId: String(userId),
            endpoint,
            deviceId,
        });

        const subscription = await PushSubscription.findOneAndUpdate(
            { userId, endpoint },
            {
                $set: {
                    keys,
                    isActive: true,
                    userAgent,
                    deviceId,
                    updatedAt: new Date(),
                },
            },
            { new: true, upsert: true },
        );

        this.logger.info("Push subscription saved", {
            userId: String(userId),
            subscriptionId: String(subscription._id),
        });

        return subscription;
    }

    async deactivate({ userId, endpoint }) {
        this.logger.info("Deactivating a push subscription", {
            userId: String(userId),
            endpoint,
        });

        return await PushSubscription.findOneAndUpdate(
            { userId, endpoint },
            { isActive: false },
        );
    }
}

module.exports = { PushService };
