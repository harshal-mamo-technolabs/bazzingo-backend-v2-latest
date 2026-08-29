const mongoose = require("mongoose");

const UserDailyActivitySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        date: {
            type: Date,
            required: true,
        },
        isGamePlayed: {
            type: Boolean,
            default: false,
        },
        isAssessmentCompleted: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    },
);

UserDailyActivitySchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("UserDailyActivity", UserDailyActivitySchema);
