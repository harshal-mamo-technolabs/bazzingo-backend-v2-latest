const mongoose = require("mongoose");

const NotificationReceiptSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        notificationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Notification",
            required: true,
        },
        isRead: {
            type: Boolean,
            default: false,
        },
        readAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    },
);

NotificationReceiptSchema.index(
    {
        userId: 1,
        notificationId: 1,
    },
    {
        unique: true,
    },
);

module.exports = mongoose.model(
    "NotificationReceipt",
    NotificationReceiptSchema,
);
