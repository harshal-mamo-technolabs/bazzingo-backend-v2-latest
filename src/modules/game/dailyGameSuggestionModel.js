const mongoose = require("mongoose");

const DailySuggestionSchema = new mongoose.Schema(
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
                suggestedAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],
    },
    {
        timestamps: true,
    },
);

DailySuggestionSchema.index(
    {
        userId: 1,
        date: 1,
    },
    {
        unique: true,
    },
);

module.exports = mongoose.model("DailySuggestion", DailySuggestionSchema);
