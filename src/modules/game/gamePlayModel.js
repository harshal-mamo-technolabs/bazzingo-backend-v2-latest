const mongoose = require("mongoose");

const GamePlaySchema = new mongoose.Schema(
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
        playedAt: {
            type: Date,
            default: Date.now,
        },
        viaSuggestion: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    },
);

GamePlaySchema.index({
    userId: 1,
    playedAt: -1,
});

GamePlaySchema.index({
    userId: 1,
    gameId: 1,
    playedAt: -1,
});

module.exports = mongoose.model("GamePlay", GamePlaySchema);
