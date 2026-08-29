const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const {
    getCETMidnight,
    getStartOfWeek,
    getEndOfWeek,
} = require("../../common/utils/time");
const {
    RESPONSE_STATUS,
    GAME_MESSAGES,
    BADGE_CONTEXT_TYPES,
    WEEK_DAYS,
    MONDAY_FIRST_WEEK_DAYS,
    DUPLICATE_KEY_ERROR_CODE,
} = require("../../constants");

class GameController {
    constructor(
        gameService,
        leaderboardService,
        badgeService,
        streakService,
        logger,
    ) {
        this.gameService = gameService;
        this.leaderboardService = leaderboardService;
        this.badgeService = badgeService;
        this.streakService = streakService;
        this.logger = logger;
    }

    async createGame(req, res, next) {
        const { name, category, url, thumbnail, isActive } = req.body;

        this.logger.info("Request to create a game", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            name,
        });

        if (!name || !category || !url) {
            this.logger.warn("Game creation is missing required fields", {
                requestId: req.requestId,
                received: Object.keys(req.body),
            });
            return next(createHttpError(400, GAME_MESSAGES.CREATE_REQUIRED));
        }

        const game = await this.gameService.create({
            name,
            category,
            url,
            thumbnail,
            isActive,
        });

        this.logger.info("Game created", {
            requestId: req.requestId,
            gameId: String(game._id),
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.CREATED,
            data: { game },
        });
    }

    async listGames(req, res) {
        this.logger.info("Request to list the games", {
            requestId: req.requestId,
        });

        const games = await this.gameService.listActive();

        this.logger.info("Games sent", {
            requestId: req.requestId,
            count: games.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.LISTED,
            data: { games },
        });
    }

    async gamesStats(req, res) {
        this.logger.info("Request to read the game stats", {
            requestId: req.requestId,
            userId: String(req.user._id),
        });

        const { total, byCategory } = await this.gameService.stats();

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.STATS,
            data: { total, byCategory },
        });
    }

    async trackPlay(req, res, next) {
        const { gameId } = req.body;
        const userId = req.user._id;

        this.logger.info("Request to track a game play", {
            requestId: req.requestId,
            userId: String(userId),
            gameId,
        });

        if (!gameId) {
            this.logger.warn("Play tracking is missing the gameId", {
                requestId: req.requestId,
                userId: String(userId),
            });
            return next(createHttpError(400, GAME_MESSAGES.GAME_ID_REQUIRED));
        }

        const game = await this.gameService.findById(gameId);

        if (!game || !game.isActive) {
            this.logger.warn("Play tracking hit a missing or inactive game", {
                requestId: req.requestId,
                userId: String(userId),
                gameId,
            });
            return next(createHttpError(404, GAME_MESSAGES.NOT_FOUND));
        }

        const suggestion =
            await this.gameService.findTodaysChallengeFor(gameId);

        const play = await this.gameService.trackPlay({
            userId,
            gameId,
            viaSuggestion: Boolean(suggestion),
        });

        this.logger.info("Game play tracked", {
            requestId: req.requestId,
            userId: String(userId),
            playId: String(play._id),
            viaSuggestion: play.viaSuggestion,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.PLAY_TRACKED,
            data: { play },
        });
    }

    async recentlyPlayed(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the recently played games", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const plays = await this.gameService.recentlyPlayed(userId);

        this.logger.info("Recently played games sent", {
            requestId: req.requestId,
            userId: String(userId),
            count: plays.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.RECENTLY_PLAYED,
            data: { plays },
        });
    }

    async uniqueGamesCount(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to count the unique games played", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const count = await this.gameService.uniqueGamesCount(userId);

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.UNIQUE_GAMES_COUNT,
            data: { count },
        });
    }

    async getDailySuggestions(req, res) {
        const userId = req.user._id;
        const today = getCETMidnight(new Date());

        this.logger.info("Request to read the daily suggestions", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const suggestion = await this.gameService.findTodaysChallenge();

        if (!suggestion) {
            this.logger.info("No daily challenge exists for today", {
                requestId: req.requestId,
                userId: String(userId),
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: GAME_MESSAGES.NO_DAILY_SUGGESTIONS,
                data: { suggestion: null },
            });
        }

        const playedGameIds = await this.gameService.playedSuggestionIds({
            userId,
            gameIds: suggestion.games.map((game) => game.gameId._id),
            suggestedDate: today,
        });

        const games = suggestion.games.map((game) => ({
            ...game.toObject(),
            isPlayed: playedGameIds.has(String(game.gameId._id)),
        }));

        this.logger.info("Daily suggestions sent", {
            requestId: req.requestId,
            userId: String(userId),
            games: games.length,
            played: playedGameIds.size,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.DAILY_SUGGESTIONS,
            data: { suggestion: { ...suggestion.toObject(), games } },
        });
    }

    async submitScore(req, res, next) {
        const { gameId, score } = req.body;
        const userId = req.user._id;

        this.logger.info("Request to submit a game score", {
            requestId: req.requestId,
            userId: String(userId),
            gameId,
            score,
        });

        if (!gameId || typeof score !== "number") {
            this.logger.warn("Score submission failed validation", {
                requestId: req.requestId,
                userId: String(userId),
            });
            return next(createHttpError(400, GAME_MESSAGES.SCORE_REQUIRED));
        }

        const game = await this.gameService.findById(gameId);

        if (!game || !game.isActive) {
            this.logger.warn("Score submission hit a missing game", {
                requestId: req.requestId,
                userId: String(userId),
                gameId,
            });
            return next(createHttpError(404, GAME_MESSAGES.NOT_FOUND));
        }

        if (score <= 0) {
            this.logger.info("Score submission was not positive", {
                requestId: req.requestId,
                userId: String(userId),
                score,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: GAME_MESSAGES.ZERO_SCORE,
            });
        }

        const today = getCETMidnight(new Date());
        const suggestion =
            await this.gameService.findTodaysChallengeFor(gameId);

        if (!suggestion) {
            this.logger.warn("Score submitted for a game not suggested today", {
                requestId: req.requestId,
                userId: String(userId),
                gameId,
            });
            return next(createHttpError(400, GAME_MESSAGES.NOT_SUGGESTED));
        }

        let doc;

        try {
            doc = await this.gameService.recordScore({
                userId,
                gameId,
                score,
                suggestedDate: today,
            });
        } catch (err) {
            if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
                this.logger.warn("Score was already recorded today", {
                    requestId: req.requestId,
                    userId: String(userId),
                    gameId,
                });
                return next(
                    createHttpError(400, GAME_MESSAGES.ALREADY_RECORDED),
                );
            }

            throw err;
        }

        await this.leaderboardService.addGameScore({
            userId,
            category: game.category,
            score,
        });

        await this.streakService.markGamePlayed({ userId, date: today });

        await this.unlockBadges(req, { game, score, gameId });

        this.logger.info("Game score submitted", {
            requestId: req.requestId,
            userId: String(userId),
            scoreId: String(doc._id),
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.SCORE_RECORDED,
            data: { score: doc },
        });
    }

    async unlockBadges(req, { game, score, gameId }) {
        try {
            return await this.badgeService.checkAndUnlockBadges(req.user._id, {
                type: BADGE_CONTEXT_TYPES.GAME,
                gameCategory: game.category,
                score,
                gameId,
            });
        } catch (err) {
            this.logger.error("Badge check after a game score failed", {
                requestId: req.requestId,
                userId: String(req.user._id),
                message: err.message,
            });

            return [];
        }
    }

    async getCurrentWeekScores(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the current week scores", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const dailyScores = await this.gameService.weeklyScores({
            userId,
            startOfWeek: getStartOfWeek(),
            endOfWeek: getEndOfWeek(),
        });

        const scoresByDay = Object.fromEntries(
            WEEK_DAYS.map((day) => [day, 0]),
        );

        dailyScores.forEach(({ dayOfWeek, totalScore }) => {
            scoresByDay[WEEK_DAYS[dayOfWeek - 1]] = totalScore;
        });

        const scores = Object.fromEntries(
            MONDAY_FIRST_WEEK_DAYS.map((day) => [day, scoresByDay[day]]),
        );

        this.logger.info("Current week scores sent", {
            requestId: req.requestId,
            userId: String(userId),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.WEEKLY_SCORES,
            data: { scores },
        });
    }

    async getGameStatistics(req, res) {
        const userId = req.user._id;

        this.logger.info("Request to read the game statistics", {
            requestId: req.requestId,
            userId: String(userId),
        });

        const leaderboard = await this.leaderboardService.findByUserId(userId);
        const gameGlobalRank = leaderboard?.gameGlobalRank || 1;
        const allCategories = await this.gameService.activeCategories();

        const statistics = {};

        for (const [periodName, range] of Object.entries(this.timePeriods())) {
            statistics[periodName] = await this.periodStatistics({
                userId,
                range,
                allCategories,
                gameGlobalRank,
            });
        }

        this.logger.info("Game statistics sent", {
            requestId: req.requestId,
            userId: String(userId),
            rank: gameGlobalRank,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: GAME_MESSAGES.STATISTICS,
            data: { statistics, rank: gameGlobalRank },
        });
    }

    async periodStatistics({ userId, range, allCategories, gameGlobalRank }) {
        const { uniqueGames, gameScores } =
            await this.gameService.scoresInPeriod({
                userId,
                start: range.start,
                end: range.end,
            });

        const categoryStats = Object.fromEntries(
            allCategories.map((category) => [category, 0]),
        );

        let totalScore = 0;

        for (const gameScore of gameScores) {
            if (gameScore.gameId && gameScore.gameId.category) {
                categoryStats[gameScore.gameId.category] += gameScore.score;
                totalScore += gameScore.score;
            }
        }

        const categoryCount = allCategories.length;

        return {
            totalGamePlayed: uniqueGames.length,
            statistics: categoryStats,
            brainIndex:
                categoryCount > 0 ? Math.round(totalScore / categoryCount) : 0,
            rank: gameGlobalRank,
            totalScore,
            categoryCount,
        };
    }

    timePeriods(now = new Date()) {
        return {
            today: {
                start: new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate(),
                ),
                end: new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate() + 1,
                ),
            },
            last7Days: {
                start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
                end: now,
            },
            last1Month: {
                start: new Date(
                    now.getFullYear(),
                    now.getMonth() - 1,
                    now.getDate(),
                ),
                end: now,
            },
            last3Months: {
                start: new Date(
                    now.getFullYear(),
                    now.getMonth() - 3,
                    now.getDate(),
                ),
                end: now,
            },
            last6Months: {
                start: new Date(
                    now.getFullYear(),
                    now.getMonth() - 6,
                    now.getDate(),
                ),
                end: now,
            },
            last1Year: {
                start: new Date(
                    now.getFullYear() - 1,
                    now.getMonth(),
                    now.getDate(),
                ),
                end: now,
            },
        };
    }
}

module.exports = { GameController };
