const mongoose = require("mongoose");
const { Schema } = mongoose;

const SubscriptionSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            index: true,
            required: false,
        },
        stripeSubscriptionId: {
            type: String,
            unique: true,
            index: true,
            required: true,
        },
        stripeSessionId: { type: String, index: true, default: null },
        priceCatalogId: {
            type: Schema.Types.ObjectId,
            ref: "PriceCatalog",
            index: true,
            required: false,
        },
        planId: { type: String, required: false },
        isElementsFlow: { type: Boolean, default: false },
        status: {
            type: String,
            enum: [
                "incomplete",
                "incomplete_expired",
                "trialing",
                "active",
                "past_due",
                "canceled",
                "unpaid",
            ],
            required: true,
        },
        billingAmounts: [
            {
                amount: Number,
                currency: String,
                date: Date,
                invoiceId: { type: String, default: null },
                billingReason: {
                    type: String,
                    enum: [
                        "subscription_create",
                        "subscription_cycle",
                        "subscription_update",
                        "manual",
                        "refund",
                        "trial_payment",
                    ],
                    default: "subscription_cycle",
                },
            },
        ],
        nextBillingDate: { type: Date },
        planDuration: { type: String, enum: ["monthly", "yearly"] },
        cancelAt: { type: Date, default: null },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        cancelReason: { type: String, default: null },
        wouldHaveStayedIfOffered: { type: [String] },
        currentPeriodStart: { type: Date, required: true },
        currentPeriodEnd: { type: Date, required: true },
        trialStart: { type: Date, default: null },
        trialEnd: { type: Date, default: null },
        metadata: { type: Map, of: String },
    },
    { timestamps: true },
);

SubscriptionSchema.pre("validate", function (next) {
    if (!this.isElementsFlow && !this.userId) {
        this.invalidate(
            "userId",
            "userId is required for non-Elements flow subscriptions",
        );
    }
    next();
});

module.exports = mongoose.model("Subscription", SubscriptionSchema);
