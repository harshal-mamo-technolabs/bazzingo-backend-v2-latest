const mongoose = require("mongoose");
const { Schema } = mongoose;

const QuestionAndAnswerSchema = new Schema(
    {
        fullAssessment: {
            type: Schema.Types.ObjectId,
            ref: "FullAssessment",
            required: true,
        },
        quickAssessment: [
            {
                type: Schema.Types.ObjectId,
                ref: "QuickMiniAssessment",
                required: true,
            },
        ],
        subcategory: { type: String, required: true, trim: true },
        questionType: { type: String, enum: ["text", "image"], required: true },
        imageQuestionDescription: { type: String, default: null },
        question: { type: String, required: true, trim: true },
        optionsType: { type: String, enum: ["text", "image"], required: true },
        options: {
            type: [String],
            required: true,
            validate: {
                validator: (v) => Array.isArray(v) && v.length === 4,
                message: "options must contain exactly 4 entries.",
            },
        },
        answerIndex: { type: Number, min: 0, max: 3, required: true },
        points: { type: Number, min: 1 },
    },
    { timestamps: true },
);

QuestionAndAnswerSchema.index({
    fullAssessment: 1,
    quickAssessment: 1,
    subcategory: 1,
});

module.exports = mongoose.model("QuestionAndAnswer", QuestionAndAnswerSchema);
