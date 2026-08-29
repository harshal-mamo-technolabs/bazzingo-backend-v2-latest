const mongoose = require("mongoose");
const { Schema } = mongoose;

const EmotionalIntelligenceAssessmentSchema = new mongoose.Schema(
    {
        title: { type: String },
        description: { type: String, default: "" },
        questions: { type: Number, required: true, min: 1 },
        subCategories: [{ type: String, required: true }],
        priceCatalogId: { type: Schema.Types.ObjectId, ref: "PriceCatalog" },
        isAvailReport: { type: Boolean, default: true },
        isAvailCertification: { type: Boolean, default: true },
        active: { type: Boolean, default: true },
    },
    { timestamps: true },
);

module.exports = mongoose.model(
    "EmotionalIntelligenceAssessment",
    EmotionalIntelligenceAssessmentSchema,
);
