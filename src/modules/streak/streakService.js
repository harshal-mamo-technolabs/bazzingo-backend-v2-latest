const UserDailyActivity = require("./userDailyActivityModel");

class StreakService {
    constructor(logger) {
        this.logger = logger;
    }

    async upsertForUser({ userId, update }) {
        this.logger.info("Upserting the daily activity for a user", {
            userId: String(userId),
            fields: Object.keys(update),
        });

        return await UserDailyActivity.findOneAndUpdate(
            { userId },
            { $setOnInsert: { userId }, $set: update },
            { new: true, upsert: true },
        );
    }

    async findInRange({ userId, start, end }) {
        this.logger.info("Reading the daily activity in a range", {
            userId: String(userId),
            start: start.toISOString(),
            end: end.toISOString(),
        });

        return await UserDailyActivity.find({
            userId,
            createdAt: { $gte: start, $lte: end },
        })
            .sort({ createdAt: 1 })
            .lean();
    }

    async markGamePlayed({ userId, date }) {
        return await this.markActivity({ userId, date, isGamePlayed: true });
    }

    async markAssessmentCompleted({ userId, date }) {
        return await this.markActivity({
            userId,
            date,
            isAssessmentCompleted: true,
        });
    }

    async markActivity({ userId, date, ...flags }) {
        try {
            const activity = await UserDailyActivity.findOneAndUpdate(
                { userId, date },
                { $setOnInsert: { userId, date }, $set: flags },
                { upsert: true, new: true },
            );

            this.logger.info("Daily activity recorded", {
                userId: String(userId),
                date: date.toISOString(),
                flags: Object.keys(flags),
            });

            return activity;
        } catch (err) {
            this.logger.error("Failed to record the daily activity", {
                userId: String(userId),
                flags: Object.keys(flags),
                message: err.message,
            });

            return null;
        }
    }
}

module.exports = { StreakService };
