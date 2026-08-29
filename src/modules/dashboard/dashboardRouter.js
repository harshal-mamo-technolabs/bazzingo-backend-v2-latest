const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { AssessmentService } = require("../assessment/assessmentService");
const { GameService } = require("../game/gameService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { StreakService } = require("../streak/streakService");
const { UserService } = require("../user/userService");
const { DashboardController } = require("./dashboardController");
const { DashboardService } = require("./dashboardService");

const router = express.Router();

const dashboardController = new DashboardController(
    new DashboardService(
        logger,
        new UserService(logger, new LeaderboardService(logger)),
        new GameService(logger),
        new AssessmentService(logger),
        new StreakService(logger),
    ),
    logger,
);

const handler = (method) =>
    asyncWrapper(dashboardController[method].bind(dashboardController));

router.use(requireAuth);

router.route("/").get(handler("getDashboardStats"));
router.route("/recent-activity").get(handler("getRecentActivity"));
router.route("/daily-streak-status").get(handler("getDailyStreakStatus"));

module.exports = router;
