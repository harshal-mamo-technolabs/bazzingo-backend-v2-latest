const mongoose = require("mongoose");

const GameScoreSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        gameId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Game",
            required: true,
        },
        score: {
            type: Number,
            required: true,
            min: 0,
            max: 200,
        },
        playedAt: {
            type: Date,
            default: Date.now,
        },
        suggestedDate: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
    },
);

GameScoreSchema.index(
    {
        userId: 1,
        gameId: 1,
        suggestedDate: 1,
    },
    {
        unique: true,
    },
);

module.exports = mongoose.model("GameScore", GameScoreSchema);
