const mongoose = require("mongoose");
const { Schema } = mongoose;

const PlanSchema = new Schema(
    {
        name: { type: String, required: true },
        description: { type: String, default: "" },
        prices: {
            monthly: {
                priceId: { type: Schema.Types.ObjectId, ref: "PriceCatalog" },
                intervalCount: { type: Number, default: 1 },
            },
            yearly: {
                priceId: { type: Schema.Types.ObjectId, ref: "PriceCatalog" },
                intervalCount: { type: Number, default: 1 },
            },
            trial: { type: Schema.Types.ObjectId, ref: "PriceCatalog" },
        },
        stripeProductId: { type: String, required: true },
        active: { type: Boolean, default: true },
    },
    { timestamps: true },
);

module.exports = mongoose.model("Plan", PlanSchema);
