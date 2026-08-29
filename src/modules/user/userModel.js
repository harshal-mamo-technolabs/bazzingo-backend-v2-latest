const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            unique: true,
            required: true,
            lowercase: true,
        },
        avatar: {
            type: String,
        },
        password: {
            type: String,
            required: function () {
                return !this.googleId;
            },
        },
        passwordResetToken: {
            type: String,
            default: null,
        },
        age: {
            type: Number,
        },
        country: {
            type: String,
        },
        iq: {
            type: Number,
            default: 0,
            min: 0,
            max: 200,
        },
        iqScores: [
            {
                date: {
                    type: Date,
                    required: true,
                },
                iqScore: {
                    type: Number,
                    required: true,
                    min: 0,
                    max: 200,
                },
                assessmentScore: {
                    type: Number,
                    required: true,
                },
                ageGroup: {
                    type: String,
                    required: true,
                },
            },
        ],
        drivingLicense: {
            type: Number,
            default: 0,
            min: 0,
            max: 200,
        },
        drivingLicenseScores: [
            {
                date: {
                    type: Date,
                    required: true,
                },
                drivingLicenseScore: {
                    type: Number,
                    required: true,
                    min: 0,
                    max: 200,
                },
                assessmentScore: {
                    type: Number,
                    required: true,
                },
                ageGroup: {
                    type: String,
                    required: true,
                },
            },
        ],
        programScore: {
            type: Map,
            of: {
                programScore: {
                    type: Number,
                    required: true,
                },
                scores: [
                    {
                        programScore: {
                            type: Number,
                            required: true,
                        },
                        date: {
                            type: Date,
                            required: true,
                        },
                        assessmentScore: {
                            type: Number,
                            required: true,
                        },
                    },
                ],
            },
            default: new Map(),
        },
        preferences: {
            email: {
                gameReminders: {
                    type: Boolean,
                    default: true,
                },
                newAssessmentsAvailable: {
                    type: Boolean,
                    default: true,
                },
                achievementAndBadgeAlerts: {
                    type: Boolean,
                    default: true,
                },
                weeklyPerformanceSummary: {
                    type: Boolean,
                    default: true,
                },
            },
            push: {
                enablePushNotifications: {
                    type: Boolean,
                    default: true,
                },
            },
            newsletter: {
                subscribeToTipsAndNews: {
                    type: Boolean,
                    default: true,
                },
            },
        },
        userFunnelAssessmentCategory: {
            type: String,
            default: "iq-test",
        },
        stripeCustomerId: {
            type: String,
        },
        googleId: {
            type: String,
            unique: true,
            sparse: true,
        },
        defaultPaymentMethodId: { type: String, default: null },
        landingPageName: {
            type: String,
        },
        quickMiniAssessmntId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "QuickMiniAssessment",
        },
        isAssessmentSubmited: {
            type: Boolean,
            default: false,
        },
        utmSource: {
            type: String,
            default: "default",
        },
        utmCampaign: {
            type: String,
            default: "default",
        },
        utmMedium: {
            type: String,
            default: "default",
        },
        utmEmail: {
            type: String,
        },
        msisdn: {
            type: String,
            unique: true,
            sparse: true,
        },
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
        deletedAt: {
            type: Date,
            default: null,
        },
        deletionReason: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: {
            transform(_doc, ret) {
                delete ret.password;
                delete ret.passwordResetToken;
                delete ret.utmSource;
                delete ret.utmCampaign;
                delete ret.utmMedium;
                delete ret.utmEmail;
                return ret;
            },
        },
        toObject: {
            transform(_doc, ret) {
                delete ret.password;
                delete ret.passwordResetToken;
                delete ret.utmSource;
                delete ret.utmCampaign;
                delete ret.utmMedium;
                delete ret.utmEmail;
                return ret;
            },
        },
    },
);

module.exports = mongoose.model("User", UserSchema);
