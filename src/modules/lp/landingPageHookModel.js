const mongoose = require("mongoose");
const { Schema } = mongoose;

const LandingPageHookSchema = new Schema(
    {
        uuid: { type: String, required: true, unique: true, index: true },
        email: { type: String, lowercase: true },
        name: { type: String },
        age: { type: Number },
        country: { type: String },
        paymentCompleted: { type: Boolean, default: false },
        paymentInitiated: { type: Boolean, default: false },
        assessmentStatus: {
            type: String,
            enum: ["pending", "completed"],
            default: "pending",
        },
        questionNumber: { type: Number, default: 0 },
        assessmentId: {
            type: Schema.Types.ObjectId,
            ref: "QuickMiniAssessment",
        },
        landingPageName: { type: String },
        utmSource: { type: String, default: "default" },
        utmCampaign: { type: String, default: "default" },
        utmMedium: { type: String, default: "default" },
        utmEmail: { type: String },
        answers: [{ _id: false, questionId: String, chosenIndex: Number }],
    },
    { timestamps: true },
);

module.exports = mongoose.model("LandingPageHook", LandingPageHookSchema);
