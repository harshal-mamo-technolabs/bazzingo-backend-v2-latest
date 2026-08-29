const {
    NOTIFICATION_TARGET_TYPES,
    NOTIFICATION_UPDATABLE_FIELDS,
} = require("../../constants");
const PushSubscription = require("../push/pushSubscriptionModel");
const User = require("../user/userModel");
const Notification = require("./notificationModel");
const NotificationReceipt = require("./notificationReceiptModel");

class NotificationService {
    constructor(logger, pushService, sendWebPush) {
        this.logger = logger;
        this.pushService = pushService;
        this.sendWebPush = sendWebPush;
    }

    async create({ title, body, imageUrl, websiteUrl, target, createdBy }) {
        this.logger.info("Persisting notification to the database", {
            title,
            targetType: target?.type,
        });

        const notificationData = {
            title,
            body,
            target,
            createdBy,
            pushSent: false,
        };

        if (imageUrl) notificationData.imageUrl = imageUrl;
        if (websiteUrl) notificationData.websiteUrl = websiteUrl;

        const notification = await Notification.create(notificationData);

        this.logger.info("Notification persisted", {
            notificationId: String(notification._id),
        });

        return notification;
    }

    async list({ page, limit }) {
        this.logger.info("Reading the notifications", { page, limit });

        const [items, total] = await Promise.all([
            Notification.find({})
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            Notification.countDocuments({}),
        ]);

        return { items, total };
    }

    async findById(notificationId) {
        return await Notification.findById(notificationId);
    }

    async update(notificationId, body) {
        const updates = NOTIFICATION_UPDATABLE_FIELDS.reduce(
            (accumulator, field) => {
                if (Object.prototype.hasOwnProperty.call(body, field)) {
                    accumulator[field] = body[field];
                }

                return accumulator;
            },
            {},
        );

        this.logger.info("Updating notification in the database", {
            notificationId,
            fields: Object.keys(updates),
        });

        return await Notification.findByIdAndUpdate(notificationId, updates, {
            new: true,
            runValidators: true,
        });
    }

    async delete(notificationId) {
        this.logger.info("Deleting notification from the database", {
            notificationId,
        });

        return await Notification.findByIdAndDelete(notificationId);
    }

    buildEligibilityFilter(user) {
        return {
            isActive: true,
            $or: [
                { "target.type": NOTIFICATION_TARGET_TYPES.ALL },
                {
                    "target.type": NOTIFICATION_TARGET_TYPES.USER,
                    "target.userId": user._id,
                },
                {
                    "target.type": NOTIFICATION_TARGET_TYPES.CRITERIA,
                    $and: [
                        {
                            $or: [
                                { "target.criteria.countries": { $size: 0 } },
                                { "target.criteria.countries": user.country },
                            ],
                        },
                        {
                            $or: [
                                {
                                    "target.criteria.minAge": {
                                        $exists: false,
                                    },
                                },
                                {
                                    "target.criteria.minAge": {
                                        $lte: user.age ?? 0,
                                    },
                                },
                            ],
                        },
                        {
                            $or: [
                                {
                                    "target.criteria.maxAge": {
                                        $exists: false,
                                    },
                                },
                                {
                                    "target.criteria.maxAge": {
                                        $gte: user.age ?? 0,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
    }

    async findForUser(user) {
        this.logger.info("Reading the notifications for a user", {
            userId: String(user._id),
        });

        const [allEligible, receipts] = await Promise.all([
            Notification.find(this.buildEligibilityFilter(user))
                .sort({ createdAt: -1 })
                .lean(),
            NotificationReceipt.find({ userId: user._id })
                .select("notificationId isRead")
                .lean(),
        ]);

        const readSet = new Set(
            receipts
                .filter((receipt) => receipt.isRead)
                .map((receipt) => String(receipt.notificationId)),
        );

        const unread = allEligible.filter(
            (notification) => !readSet.has(String(notification._id)),
        );
        const read = allEligible.filter((notification) =>
            readSet.has(String(notification._id)),
        );

        return { unread, read };
    }

    async markAsRead({ userId, notificationId }) {
        this.logger.info("Marking a notification as read", {
            userId: String(userId),
            notificationId,
        });

        return await NotificationReceipt.findOneAndUpdate(
            { userId, notificationId },
            { isRead: true, readAt: new Date() },
            { new: true, upsert: true },
        );
    }

    buildRecipientFilter(target) {
        if (target.type === NOTIFICATION_TARGET_TYPES.USER) {
            return { _id: target.userId };
        }

        if (target.type === NOTIFICATION_TARGET_TYPES.CRITERIA) {
            const conditions = [];

            if (
                Array.isArray(target.criteria?.countries) &&
                target.criteria.countries.length > 0
            ) {
                conditions.push({
                    country: { $in: target.criteria.countries },
                });
            }

            if (typeof target.criteria?.minAge === "number") {
                conditions.push({ age: { $gte: target.criteria.minAge } });
            }

            if (typeof target.criteria?.maxAge === "number") {
                conditions.push({ age: { $lte: target.criteria.maxAge } });
            }

            return conditions.length ? { $and: conditions } : {};
        }

        return {};
    }

    async dispatchPush(notification) {
        try {
            if (notification.pushSent) {
                this.logger.info("Push was already dispatched", {
                    notificationId: String(notification._id),
                });
                return;
            }

            const userFilter = this.buildRecipientFilter(notification.target);

            const recipients = await User.find({
                ...userFilter,
                isDeleted: { $ne: true },
            }).select("_id");

            this.logger.info("Resolved the push recipients", {
                notificationId: String(notification._id),
                targetType: notification.target.type,
                recipients: recipients.length,
            });

            if (recipients.length === 0) {
                await Notification.findByIdAndUpdate(notification._id, {
                    pushSent: true,
                });
                return;
            }

            const subscriptions = await PushSubscription.find({
                userId: { $in: recipients.map((user) => user._id) },
                isActive: true,
            }).lean();

            const payload = {
                title: notification.title,
                body: notification.body,
                imageUrl: notification.imageUrl,
                websiteUrl: notification.websiteUrl,
                notificationId: notification._id,
            };

            const results = await Promise.allSettled(
                subscriptions.map((subscription) =>
                    this.sendWebPush(
                        {
                            endpoint: subscription.endpoint,
                            keys: subscription.keys,
                        },
                        payload,
                    ),
                ),
            );

            const expired = [];
            let delivered = 0;
            let failed = 0;

            results.forEach((result, index) => {
                if (result.status === "fulfilled" && result.value?.remove) {
                    expired.push(subscriptions[index]._id);
                } else if (result.status === "fulfilled" && result.value?.ok) {
                    delivered += 1;
                } else {
                    failed += 1;
                }
            });

            if (expired.length > 0) {
                await PushSubscription.updateMany(
                    { _id: { $in: expired } },
                    { isActive: false },
                );
            }

            await Notification.findByIdAndUpdate(notification._id, {
                pushSent: true,
            });

            this.logger.info("Push dispatch finished", {
                notificationId: String(notification._id),
                subscriptions: subscriptions.length,
                delivered,
                failed,
                deactivated: expired.length,
            });
        } catch (err) {
            this.logger.error("Push dispatch failed", {
                notificationId: String(notification._id),
                message: err.message,
                stack: err.stack,
            });
        }
    }
}

module.exports = { NotificationService };
