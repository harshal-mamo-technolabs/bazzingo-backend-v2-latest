const mongoose = require("mongoose");

const DailyChallengeSchema = new mongoose.Schema(
    {
        date: {
            type: Date,
            required: true,
            unique: true,
        },
        games: [
            {
                gameId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Game",
                    required: true,
                },
                difficulty: {
                    type: String,
                    enum: ["easy", "moderate", "hard"],
                    required: true,
                },
            },
        ],
        quickAssessmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "QuickMiniAssessment",
            required: true,
        },
        cycleNumber: {
            type: Number,
            default: 1,
        },
    },
    { timestamps: true },
);

DailyChallengeSchema.index({ date: 1 }, { unique: true });

module.exports = mongoose.model("DailyChallenge", DailyChallengeSchema);
