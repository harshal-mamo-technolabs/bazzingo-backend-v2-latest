const mongoose = require("mongoose");

const TargetSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ["ALL", "USER", "CRITERIA"],
            required: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        criteria: {
            countries: [
                {
                    type: String,
                },
            ],
            minAge: {
                type: Number,
            },
            maxAge: {
                type: Number,
            },
            subscribed: {
                type: Boolean,
                default: false,
            },
        },
    },
    {
        _id: false,
    },
);

const NotificationSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
        },
        body: {
            type: String,
            required: true,
        },
        imageUrl: {
            type: String,
        },
        websiteUrl: {
            type: String,
        },
        target: {
            type: TargetSchema,
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        pushSent: {
            type: Boolean,
            default: false,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Admin",
        },
    },
    {
        timestamps: true,
    },
);

NotificationSchema.index({
    "target.type": 1,
    createdAt: -1,
});

module.exports = mongoose.model("Notification", NotificationSchema);
