const mongoose = require("mongoose");

const AssessmentScoreSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        type: { type: String, enum: ["full", "quick"], required: true },
        assessmentId: { type: mongoose.Schema.Types.ObjectId, required: true },
        mainCategory: { type: String, required: true },
        date: { type: Date, required: true },
        totalScore: { type: Number, required: true, min: 0 },
        programScore: { type: Number, min: 0 },
        byCategory: { type: Map, of: Number, default: () => ({}) },
    },
    { timestamps: true },
);

AssessmentScoreSchema.index(
    { userId: 1, type: 1, assessmentId: 1 },
    { unique: true },
);

module.exports = mongoose.model("AssessmentScore", AssessmentScoreSchema);
