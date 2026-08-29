const mongoose = require("mongoose");

const PriceCatalogSchema = new mongoose.Schema(
    {
        assessmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FullAssessment",
            required: false,
        },
        planId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Plan",
            required: false,
        },
        stripePriceId: { type: String, unique: true, index: true },
        stripeProductId: { type: String, index: true },
        type: { type: String, enum: ["recurring", "one_time"], required: true },
        lookupKey: { type: String, index: true, sparse: true },
        currency: { type: String, default: "EUR" },
        unitAmount: Number,
        active: { type: Boolean, default: true },
        default: { type: Boolean, default: false },
        productDuration: {
            type: String,
            enum: ["daily", "weekly", "monthly", "yearly", "onetime"],
            default: "monthly",
        },
        metadata: { type: Map, of: String },
    },
    { timestamps: true },
);

const PriceCatalog = mongoose.model("PriceCatalog", PriceCatalogSchema);

module.exports = PriceCatalog;
