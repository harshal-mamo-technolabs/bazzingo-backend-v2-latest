const mongoose = require("mongoose");

const DailyQuickAssignmentSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        date: { type: Date, required: true },
        quickAssessmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "QuickMiniAssessment",
            required: true,
        },
        cycleNumber: { type: Number, default: 1 },
    },
    { timestamps: true },
);

DailyQuickAssignmentSchema.index({ userId: 1, date: 1 }, { unique: true });
DailyQuickAssignmentSchema.index(
    { userId: 1, cycleNumber: 1, quickAssessmentId: 1 },
    { unique: true },
);

module.exports = mongoose.model(
    "DailyQuickAssignment",
    DailyQuickAssignmentSchema,
);
