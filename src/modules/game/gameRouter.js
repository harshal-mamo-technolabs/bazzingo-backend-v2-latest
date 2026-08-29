const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const requireAdmin = require("../../common/middlewares/requireAdmin");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { ADMIN_ROLES } = require("../../constants");
const { BadgeService } = require("../badge/badgeService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { StreakService } = require("../streak/streakService");
const { GameController } = require("./gameController");
const { GameService } = require("./gameService");

const router = express.Router();

const gameController = new GameController(
    new GameService(logger),
    new LeaderboardService(logger),
    new BadgeService(logger),
    new StreakService(logger),
    logger,
);

const handler = (method) =>
    asyncWrapper(gameController[method].bind(gameController));

router
    .route("/games")
    .post(requireAdmin([ADMIN_ROLES.SUPERADMIN]), handler("createGame"))
    .get(handler("listGames"));

router.route("/games/stats").get(requireAuth, handler("gamesStats"));

router.route("/play").post(requireAuth, handler("trackPlay"));

router.route("/recent").get(requireAuth, handler("recentlyPlayed"));

router
    .route("/suggestions/daily")
    .get(requireAuth, handler("getDailySuggestions"));

router
    .route("/stats/unique-games")
    .get(requireAuth, handler("uniqueGamesCount"));

router.route("/score").post(requireAuth, handler("submitScore"));

router
    .route("/stats/weekly-scores")
    .get(requireAuth, handler("getCurrentWeekScores"));

router.route("/statistics").get(requireAuth, handler("getGameStatistics"));

module.exports = router;
