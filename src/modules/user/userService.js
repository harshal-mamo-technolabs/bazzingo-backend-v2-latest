const { USER_LEADERBOARD_SYNCED_FIELDS } = require("../../constants");
const User = require("./userModel");

class UserService {
    constructor(logger, leaderboardService) {
        this.logger = logger;
        this.leaderboardService = leaderboardService;
    }

    async findById(userId) {
        this.logger.info("Reading user from the database", {
            userId: String(userId),
        });

        return await User.findById(userId).select("-password");
    }

    async update(userId, updates) {
        this.logger.info("Updating user in the database", {
            userId: String(userId),
            fields: Object.keys(updates),
        });

        const user = await User.findByIdAndUpdate(userId, updates, {
            new: true,
            runValidators: true,
            select: "-password",
        });

        this.logger.info("User update finished", {
            userId: String(userId),
            updated: Boolean(user),
        });

        if (user) {
            await this.syncLeaderboardProfile(user, updates);
        }

        return user;
    }

    async syncLeaderboardProfile(user, updates) {
        const changed = USER_LEADERBOARD_SYNCED_FIELDS.filter((field) =>
            Object.prototype.hasOwnProperty.call(updates, field),
        );

        if (changed.length === 0) {
            return;
        }

        try {
            await this.leaderboardService.syncProfile({
                userId: user._id,
                age: updates.age !== undefined ? updates.age : user.age,
                country:
                    updates.country !== undefined
                        ? updates.country
                        : user.country,
                avatar:
                    updates.avatar !== undefined ? updates.avatar : user.avatar,
                name: updates.name !== undefined ? updates.name : user.name,
            });

            this.logger.info("Leaderboard profile synced after a user update", {
                userId: String(user._id),
                fields: changed,
            });
        } catch (err) {
            this.logger.error("Leaderboard profile sync failed", {
                userId: String(user._id),
                fields: changed,
                message: err.message,
                stack: err.stack,
            });
        }
    }

    async updatePreferences(userId, preferenceUpdates) {
        this.logger.info("Updating notification preferences in the database", {
            userId: String(userId),
            fields: Object.keys(preferenceUpdates),
        });

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: preferenceUpdates },
            { new: true, runValidators: true, select: "preferences" },
        );

        this.logger.info("Notification preferences update finished", {
            userId: String(userId),
            updated: Boolean(user),
        });

        return user;
    }
}

module.exports = { UserService };
