const mongoose = require("mongoose");

const BadgeUnlockSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        badgeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Badge",
            required: true,
            index: true,
        },
        unlockedAt: {
            type: Date,
            default: Date.now,
        },
        context: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    { timestamps: true },
);

BadgeUnlockSchema.index({ userId: 1, badgeId: 1 }, { unique: true });

module.exports = mongoose.model("BadgeUnlock", BadgeUnlockSchema);
