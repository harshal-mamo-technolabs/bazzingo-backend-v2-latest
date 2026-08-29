const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    LEADERBOARD_SCOPES,
    LEADERBOARD_RANK_FIELDS,
    LEADERBOARD_PAGINATION,
    LEADERBOARD_MESSAGES,
} = require("../../constants");

class LeaderboardController {
    constructor(leaderboardService, logger) {
        this.leaderboardService = leaderboardService;
        this.logger = logger;
    }

    async getLeaderboard(req, res) {
        const scope = String(
            req.query.scope || LEADERBOARD_SCOPES.GLOBAL,
        ).toLowerCase();
        const page = this.clamp(
            req.query.page,
            LEADERBOARD_PAGINATION.DEFAULT_PAGE,
            1,
            Number.MAX_SAFE_INTEGER,
        );
        const limit = this.clamp(
            req.query.limit,
            LEADERBOARD_PAGINATION.DEFAULT_LIMIT,
            LEADERBOARD_PAGINATION.MIN_LIMIT,
            LEADERBOARD_PAGINATION.MAX_LIMIT,
        );
        const { country, ageGroup } = req.query;

        this.logger.info("Request to read the leaderboard", {
            requestId: req.requestId,
            userId: String(req.user._id),
            scope,
            page,
            limit,
            country,
            ageGroup,
        });

        const currentUser = await this.leaderboardService.findByUserId(
            req.user._id,
        );

        const filter = { isDeleted: { $ne: true } };
        let sort = {};

        if (scope === LEADERBOARD_SCOPES.COUNTRY) {
            if (!country) {
                this.logger.warn(
                    "Leaderboard country scope without a country",
                    {
                        requestId: req.requestId,
                        userId: String(req.user._id),
                    },
                );

                return sendResponse(res, {
                    statusCode: 400,
                    status: RESPONSE_STATUS.FAIL,
                    message: LEADERBOARD_MESSAGES.COUNTRY_REQUIRED,
                });
            }

            filter.country = country.toLowerCase();
            sort = { [LEADERBOARD_RANK_FIELDS.GAME_COUNTRY]: 1 };
        } else if (scope === LEADERBOARD_SCOPES.AGE) {
            if (!ageGroup) {
                this.logger.warn("Leaderboard age scope without an age group", {
                    requestId: req.requestId,
                    userId: String(req.user._id),
                });

                return sendResponse(res, {
                    statusCode: 400,
                    status: RESPONSE_STATUS.FAIL,
                    message: LEADERBOARD_MESSAGES.AGE_GROUP_REQUIRED,
                });
            }

            filter.ageGroup = ageGroup;
            sort = { [LEADERBOARD_RANK_FIELDS.GAME_AGE_GROUP]: 1 };
        } else {
            sort = { [LEADERBOARD_RANK_FIELDS.GAME_GLOBAL]: 1 };
        }

        const { total, results } = await this.leaderboardService.list({
            filter,
            sort,
            page,
            limit,
        });

        this.logger.info("Leaderboard sent", {
            requestId: req.requestId,
            userId: String(req.user._id),
            scope,
            total,
            returned: results.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: LEADERBOARD_MESSAGES.FETCHED,
            data: { scope, page, limit, total, currentUser, results },
        });
    }

    clamp(value, fallback, min, max) {
        const parsed = parseInt(value, 10) || fallback;

        return Math.min(Math.max(parsed, min), max);
    }
}

module.exports = { LeaderboardController };
