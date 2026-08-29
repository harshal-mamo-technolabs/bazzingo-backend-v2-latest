const mongoose = require("mongoose");
const { Schema } = mongoose;

const FullAssessmentSchema = new mongoose.Schema(
    {
        mainCategory: { type: String, required: true },
        title: { type: String },
        description: { type: String, default: "" },
        questions: { type: Number, required: true, min: 1 },
        fixedPoint: { type: Number, default: 5, min: 1 },
        subcategories: [{ type: String, required: true }],
        stripeProductId: { type: String, required: true },
        priceId: { type: Schema.Types.ObjectId, ref: "PriceCatalog" },
        isAvailReport: { type: Boolean, default: true },
        isAvailCertification: { type: Boolean, default: true },
        active: { type: Boolean, default: true },
    },
    { timestamps: true },
);

FullAssessmentSchema.index({ mainCategory: 1 });

module.exports = mongoose.model("FullAssessment", FullAssessmentSchema);
