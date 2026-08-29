const mongoose = require("mongoose");

const BadgeSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
        },
        title: {
            type: String,
            required: true,
        },
        description: {
            type: String,
            required: true,
        },
        category: {
            type: String,
            enum: [
                "game-achievement",
                "assessment-achievement",
                "progress-stats",
                "engagement",
            ],
            required: true,
        },
        imageUrl: {
            type: String,
            default: "🏆",
        },
        rarity: {
            type: String,
            enum: ["common", "uncommon", "rare", "epic", "legendary"],
            default: "common",
        },
        criteria: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true },
);

module.exports = mongoose.model("Badge", BadgeSchema);
