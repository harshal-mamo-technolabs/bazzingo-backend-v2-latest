const mongoose = require("mongoose");

const LeaderboardSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        name: { type: String },
        country: {
            type: String,
            trim: true,
            lowercase: true,
        },
        ageGroup: {
            type: String,
            trim: true,
        },
        avatar: { type: String },

        gameGlobalRank: { type: Number, default: 1, min: 1 },
        assessmentGlobalRank: { type: Number, default: 1, min: 1 },
        gameCountryRank: { type: Number, default: 1, min: 1 },
        assessmentCountryRank: { type: Number, default: 1, min: 1 },
        gameAgeGroupRank: { type: Number, default: 1, min: 1 },
        assessmentAgeGroupRank: { type: Number, default: 1, min: 1 },

        game: {
            totalScore: { type: Number, default: 0, min: 0 },
            category: { type: Map, of: Number, default: () => ({}) },
        },
        assessment: {
            totalScore: { type: Number, default: 0, min: 0 },
            category: { type: Map, of: Number, default: () => ({}) },
        },

        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true },
);

LeaderboardSchema.index({ gameGlobalRank: 1 });
LeaderboardSchema.index({ assessmentGlobalRank: 1 });
LeaderboardSchema.index({ country: 1, gameCountryRank: 1 });
LeaderboardSchema.index({ country: 1, assessmentCountryRank: 1 });
LeaderboardSchema.index({ ageGroup: 1, gameAgeGroupRank: 1 });
LeaderboardSchema.index({ ageGroup: 1, assessmentAgeGroupRank: 1 });
LeaderboardSchema.index({ "game.totalScore": -1 });
LeaderboardSchema.index({ "assessment.totalScore": -1 });
LeaderboardSchema.index({ createdAt: 1 });
LeaderboardSchema.index({ isDeleted: 1 });

module.exports = mongoose.model("Leaderboard", LeaderboardSchema);
