const mongoose = require("mongoose");
const { Schema } = mongoose;

const EmotionalIntelligenceQuestionAndAnswerSchema = new Schema(
    {
        emotionalIntelligenceAssessmentId: {
            type: Schema.Types.ObjectId,
            ref: "EmotionalIntelligenceAssessment",
            required: true,
        },
        quickAssessmentIds: [
            {
                type: Schema.Types.ObjectId,
                ref: "QuickMiniAssessment",
                required: false,
            },
        ],
        subCategory: { type: String, required: true, trim: true },
        isReverseScored: {
            type: Boolean,
            default: false,
        },
        questionType: { type: String, enum: ["text", "image"], required: true },
        imageQuestionDescription: { type: String, default: null },
        question: { type: String, required: true, trim: true },
        optionScores: {
            type: [Number],
            default: () => [0, 1, 2, 3, 4],
        },
    },
    { timestamps: true },
);

EmotionalIntelligenceQuestionAndAnswerSchema.index({
    emotionalIntelligenceAssessmentId: 1,
    quickAssessmentIds: 1,
    subCategory: 1,
});

module.exports = mongoose.model(
    "EmotionalIntelligenceQuestionAndAnswer",
    EmotionalIntelligenceQuestionAndAnswerSchema,
);
