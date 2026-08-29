const { getCETMidnight } = require("../../common/utils/time");
const DailyChallenge = require("./dailyChallengeModel");
const Game = require("./gameModel");
const GamePlay = require("./gamePlayModel");
const GameScore = require("./gameScoreModel");

const RECENTLY_PLAYED_LIMIT = 20;

class GameService {
    constructor(logger) {
        this.logger = logger;
    }

    async create(game) {
        this.logger.info("Persisting game to the database", {
            name: game.name,
            category: game.category,
        });

        const created = await Game.create(game);

        this.logger.info("Game persisted to the database", {
            gameId: String(created._id),
        });

        return created;
    }

    async findById(gameId) {
        return await Game.findById(gameId);
    }

    async listActive() {
        this.logger.info("Reading the active games");

        return await Game.find({ isActive: true }).sort({ createdAt: -1 });
    }

    async stats() {
        this.logger.info("Aggregating the game catalogue stats");

        const [total, byCategory] = await Promise.all([
            Game.countDocuments({}),
            Game.aggregate([
                { $group: { _id: "$category", count: { $sum: 1 } } },
                { $project: { category: "$_id", count: 1, _id: 0 } },
                { $sort: { count: -1 } },
            ]),
        ]);

        return { total, byCategory };
    }

    async findTodaysChallengeFor(gameId) {
        return await DailyChallenge.findOne({
            date: getCETMidnight(new Date()),
            "games.gameId": gameId,
        });
    }

    async findTodaysChallenge() {
        return await DailyChallenge.findOne({
            date: getCETMidnight(new Date()),
        }).populate("games.gameId");
    }

    async trackPlay({ userId, gameId, viaSuggestion }) {
        this.logger.info("Persisting a game play", {
            userId: String(userId),
            gameId: String(gameId),
            viaSuggestion,
        });

        return await GamePlay.create({ userId, gameId, viaSuggestion });
    }

    async recentlyPlayed(userId) {
        this.logger.info("Aggregating the recently played games", {
            userId: String(userId),
        });

        return await GamePlay.aggregate([
            { $match: { userId } },
            { $sort: { playedAt: -1 } },
            {
                $group: {
                    _id: "$gameId",
                    lastPlayedAt: { $first: "$playedAt" },
                },
            },
            { $sort: { lastPlayedAt: -1 } },
            { $limit: RECENTLY_PLAYED_LIMIT },
            {
                $lookup: {
                    from: "games",
                    localField: "_id",
                    foreignField: "_id",
                    as: "game",
                },
            },
            { $unwind: "$game" },
            { $project: { game: 1, lastPlayedAt: 1 } },
        ]);
    }

    async uniqueGamesCount(userId) {
        const gameIds = await GamePlay.distinct("gameId", { userId });

        return gameIds.length;
    }

    async playedSuggestionIds({ userId, gameIds, suggestedDate }) {
        const played = await GameScore.find({
            userId,
            gameId: { $in: gameIds },
            suggestedDate,
        })
            .select("gameId")
            .lean();

        return new Set(played.map((score) => String(score.gameId)));
    }

    async recordScore({ userId, gameId, score, suggestedDate }) {
        this.logger.info("Persisting a game score", {
            userId: String(userId),
            gameId: String(gameId),
            score,
        });

        const created = await GameScore.create({
            userId,
            gameId,
            score,
            suggestedDate,
        });

        this.logger.info("Game score persisted", {
            userId: String(userId),
            scoreId: String(created._id),
        });

        return created;
    }

    async weeklyScores({ userId, startOfWeek, endOfWeek }) {
        this.logger.info("Aggregating the weekly scores", {
            userId: String(userId),
        });

        return await GameScore.aggregate([
            {
                $match: {
                    userId,
                    playedAt: { $gte: startOfWeek, $lte: endOfWeek },
                },
            },
            {
                $group: {
                    _id: { $dayOfWeek: "$playedAt" },
                    totalScore: { $sum: "$score" },
                },
            },
            { $project: { _id: 0, dayOfWeek: "$_id", totalScore: 1 } },
            { $sort: { dayOfWeek: 1 } },
        ]);
    }

    async activeCategories() {
        return await Game.distinct("category", { isActive: true });
    }

    async scoresInPeriod({ userId, start, end }) {
        const [uniqueGames, gameScores] = await Promise.all([
            GameScore.distinct("gameId", {
                userId,
                playedAt: { $gte: start, $lt: end },
            }),
            GameScore.find({
                userId,
                playedAt: { $gte: start, $lt: end },
            })
                .populate("gameId", "category")
                .lean(),
        ]);

        return { uniqueGames, gameScores };
    }
}

module.exports = { GameService, RECENTLY_PLAYED_LIMIT };
