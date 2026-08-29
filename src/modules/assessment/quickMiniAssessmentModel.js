const mongoose = require("mongoose");

const QuickMiniAssessmentSchema = new mongoose.Schema(
    {
        fullAssessment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FullAssessment",
            required: true,
        },
        questions: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "QuestionAndAnswer",
                required: true,
            },
        ],
        size: { type: Number, required: true, min: 1 },
        order: { type: Number, required: true, min: 1 },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
);

QuickMiniAssessmentSchema.index(
    { fullAssessment: 1, order: 1 },
    { unique: true },
);

const QuickMiniAssessment = mongoose.model(
    "QuickMiniAssessment",
    QuickMiniAssessmentSchema,
);

module.exports = QuickMiniAssessment;
