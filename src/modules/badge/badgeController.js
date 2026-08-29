const { sendResponse } = require("../../common/utils/response");
const { RESPONSE_STATUS, BADGE_MESSAGES } = require("../../constants");

class BadgeController {
    constructor(badgeService, leaderboardService, logger) {
        this.badgeService = badgeService;
        this.leaderboardService = leaderboardService;
        this.logger = logger;
    }

    async getAllBadges(req, res) {
        this.logger.info("Request to list the badges", {
            requestId: req.requestId,
        });

        const badges = await this.badgeService.listActive();

        this.logger.info("Badges sent", {
            requestId: req.requestId,
            count: badges.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: BADGE_MESSAGES.LISTED,
            data: { badges },
        });
    }

    async bulkInsertBadges(req, res) {
        this.logger.info("Request to bulk insert the badge catalogue", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
        });

        const createdBadges = await this.badgeService.replaceCatalogue();

        this.logger.info("Badge catalogue replaced", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            totalBadges: createdBadges.length,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: BADGE_MESSAGES.BULK_INSERTED,
            data: {
                totalBadges: createdBadges.length,
                badges: createdBadges.map((badge) => ({
                    name: badge.name,
                    title: badge.title,
                    category: badge.category,
                    rarity: badge.rarity,
                })),
            },
        });
    }

    async getUserRanksAndBadges(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the user ranks and badges", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const [leaderboard, allBadges, unlockedBadgeIds] = await Promise.all([
            this.leaderboardService.findByUserId(userId),
            this.badgeService.listActive({ category: 1, name: 1 }),
            this.badgeService.unlockedBadgeIds(userId),
        ]);

        const badgesByCategory = allBadges.reduce((grouped, badge) => {
            grouped[badge.category] = grouped[badge.category] || [];
            grouped[badge.category].push({
                name: badge.name,
                title: badge.title,
                imageUrl: badge.imageUrl,
                description: badge.description,
                isUnlocked: unlockedBadgeIds.has(badge._id.toString()),
            });

            return grouped;
        }, {});

        this.logger.info("User ranks and badges sent", {
            requestId: req.requestId,
            userId: String(userId),
            categories: Object.keys(badgesByCategory).length,
            unlocked: unlockedBadgeIds.size,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: BADGE_MESSAGES.RANKS_AND_BADGES,
            data: {
                assessmentAgeGroupRank:
                    leaderboard?.assessmentAgeGroupRank || null,
                gameAgeGroupRank: leaderboard?.gameAgeGroupRank || null,
                assessmentCountryRank:
                    leaderboard?.assessmentCountryRank || null,
                gameCountryRank: leaderboard?.gameCountryRank || null,
                gameGlobalRank: leaderboard?.gameGlobalRank || null,
                assessmentGlobalRank: leaderboard?.assessmentGlobalRank || null,
                country: leaderboard?.country || null,
                badge: badgesByCategory,
            },
        });
    }
}

module.exports = { BadgeController };
