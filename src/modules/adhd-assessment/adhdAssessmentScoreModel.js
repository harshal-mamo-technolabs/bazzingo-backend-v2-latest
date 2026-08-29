const mongoose = require("mongoose");

const AdhdAssessmentScoreSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        type: { type: String, enum: ["full", "quick"], required: true },
        assessmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdhdAssessment",
            index: true,
        },
        date: { type: Date, required: true },
        totalScore: { type: Number, required: true },
        byCategoryScores: { type: Map, of: Number, default: () => ({}) },
    },
    { timestamps: true },
);

AdhdAssessmentScoreSchema.index(
    { userId: 1, type: 1, assessmentId: 1 },
    { unique: true },
);

module.exports = mongoose.model(
    "AdhdAssessmentScore",
    AdhdAssessmentScoreSchema,
);
