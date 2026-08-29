const AdhdAssessmentScore = require("../adhd-assessment/adhdAssessmentScoreModel");
const AssessmentScore = require("../assessment/assessmentScoreModel");
const DailyQuickAssignment = require("../assessment/userQuickAssignmentModel");
const BadgeUnlock = require("../badge/badgeUnlockModel");
const EmotionalIntelligenceAssessmentScore = require("../ei-assessment/emotionalIntelligenceAssessmentScoreModel");
const DailySuggestion = require("../game/dailyGameSuggestionModel");
const GamePlay = require("../game/gamePlayModel");
const GameScore = require("../game/gameScoreModel");
const Leaderboard = require("../leaderboard/leaderboardModel");
const Notification = require("../notification/notificationModel");
const PushSubscription = require("../push/pushSubscriptionModel");
const UserDailyActivity = require("../streak/userDailyActivityModel");
const Order = require("../stripe/orderModel");
const Subscription = require("../stripe/subscriptionModel");
const AccountDeletionFeedback = require("./accountDeletionFeedbackModel");
const User = require("./userModel");

class UserDataService {
    constructor(logger) {
        this.logger = logger;
    }

    async safeFind(Model, userId, { sort = { createdAt: -1 } } = {}) {
        try {
            return await Model.find({ userId }).sort(sort).lean();
        } catch (err) {
            this.logger.error("Data export could not read a collection", {
                model: Model.modelName,
                userId: String(userId),
                message: err.message,
            });

            return [];
        }
    }

    async findAccount(userId) {
        return await User.findById(userId)
            .select("-password -utmSource -utmCampaign -utmMedium")
            .lean();
    }

    async collectPersonalData(userId) {
        this.logger.info("Collecting the personal data export", {
            userId: String(userId),
        });

        const [
            generalAssessments,
            adhdAssessments,
            emotionalIntelligenceAssessments,
            gameScores,
            gamePlays,
            dailyGameSuggestions,
            dailyActivity,
            quickAssignments,
            badgeUnlocks,
            orders,
            legacySubscriptions,
            notifications,
            leaderboard,
        ] = await Promise.all([
            this.safeFind(AssessmentScore, userId),
            this.safeFind(AdhdAssessmentScore, userId),
            this.safeFind(EmotionalIntelligenceAssessmentScore, userId),
            this.safeFind(GameScore, userId, { sort: { playedAt: -1 } }),
            this.safeFind(GamePlay, userId),
            this.safeFind(DailySuggestion, userId),
            this.safeFind(UserDailyActivity, userId, { sort: { date: -1 } }),
            this.safeFind(DailyQuickAssignment, userId, {
                sort: { date: -1 },
            }),
            this.safeFind(BadgeUnlock, userId),
            this.safeFind(Order, userId),
            this.safeFind(Subscription, userId),
            this.safeFind(Notification, userId),
            this.safeFind(Leaderboard, userId),
        ]);

        return {
            generalAssessments,
            adhdAssessments,
            emotionalIntelligenceAssessments,
            gameScores,
            gamePlays,
            dailyGameSuggestions,
            dailyActivity,
            quickAssignments,
            badgeUnlocks,
            orders,
            legacySubscriptions,
            notifications,
            leaderboard,
        };
    }

    async findBlockingSubscription(userId, blockingStatuses) {
        return await Subscription.findOne({
            userId,
            status: { $in: blockingStatuses },
            cancelAtPeriodEnd: { $ne: true },
        }).lean();
    }

    async findLatestSubscriptionStatus(userId) {
        const latest = await Subscription.findOne({ userId })
            .sort({ createdAt: -1 })
            .select("status")
            .lean();

        return latest?.status || null;
    }

    async recordDeletionFeedback(feedback) {
        this.logger.info("Persisting the account deletion feedback", {
            userId: String(feedback.userId),
        });

        return await AccountDeletionFeedback.create(feedback);
    }

    async silenceAccount(userId) {
        const results = await Promise.allSettled([
            Leaderboard.updateOne({ userId }, { $set: { isDeleted: true } }),
            PushSubscription.updateMany(
                { userId },
                { $set: { isActive: false } },
            ),
        ]);

        results
            .filter((result) => result.status === "rejected")
            .forEach((result) =>
                this.logger.error("Failed to silence an account surface", {
                    userId: String(userId),
                    message: result.reason?.message,
                }),
            );
    }

    async markDeleted({ userId, deletedAt, reason }) {
        this.logger.info("Flagging the user record as deleted", {
            userId: String(userId),
        });

        return await User.updateOne(
            { _id: userId },
            {
                $set: {
                    isDeleted: true,
                    deletedAt,
                    deletionReason: reason,
                    "preferences.email.gameReminders": false,
                    "preferences.email.newAssessmentsAvailable": false,
                    "preferences.email.achievementAndBadgeAlerts": false,
                    "preferences.email.weeklyPerformanceSummary": false,
                    "preferences.push.enablePushNotifications": false,
                    "preferences.newsletter.subscribeToTipsAndNews": false,
                },
            },
        );
    }
}

module.exports = { UserDataService };
