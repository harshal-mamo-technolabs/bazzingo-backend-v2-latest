const mongoose = require("mongoose");
const { Schema } = mongoose;

const OrderSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            index: true,
            required: true,
        },
        assessmentId: {
            type: Schema.Types.ObjectId,
            ref: "FullAssessment",
            index: true,
        } || {
            type: Schema.Types.ObjectId,
            ref: "AdhdAssessment",
            index: true,
        },
        priceCatalogId: {
            type: Schema.Types.ObjectId,
            ref: "PriceCatalog",
            index: true,
        },
        itemType: { type: String, index: true },
        itemId: { type: String, index: true },
        productName: { type: String },
        description: { type: String },
        currency: { type: String, default: "EUR" },
        unitAmount: Number,
        status: {
            type: String,
            enum: [
                "requires_payment_method",
                "requires_action",
                "processing",
                "succeeded",
                "canceled",
                "failed",
                "unpaid",
                "partially_refunded",
                "refunded",
            ],
            default: "requires_payment_method",
        },
        stripeSessionId: { type: String, index: true },
        stripePaymentIntentId: { type: String, index: true },
        stripeCustomerId: { type: String, index: true },
        refundedAmount: { type: Number, default: 0 },
        refundReason: { type: String, default: "" },
    },
    { timestamps: true },
);

module.exports = mongoose.model("Order", OrderSchema);
