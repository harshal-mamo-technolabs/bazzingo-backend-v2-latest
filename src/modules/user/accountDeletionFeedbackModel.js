const mongoose = require("mongoose");

const AccountDeletionFeedbackSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            index: true,
        },
        email: {
            type: String,
            lowercase: true,
            trim: true,
            index: true,
        },
        name: {
            type: String,
        },
        reason: {
            type: String,
            default: null,
        },
        wouldHaveStayedIfOffered: {
            type: [String],
            default: [],
        },
        subscriptionStatusAtDeletion: {
            type: String,
            default: null,
        },
        source: {
            type: String,
            default: "web",
        },
        deletedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
        collection: "account_deletion_feedback",
    },
);

module.exports = mongoose.model(
    "AccountDeletionFeedback",
    AccountDeletionFeedbackSchema,
);
