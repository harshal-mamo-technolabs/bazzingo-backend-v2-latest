const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { LeaderboardController } = require("./leaderboardController");
const { LeaderboardService } = require("./leaderboardService");

const router = express.Router();

const leaderboardService = new LeaderboardService(logger);
const leaderboardController = new LeaderboardController(
    leaderboardService,
    logger,
);

router
    .route("/")
    .get(
        requireAuth,
        asyncWrapper(
            leaderboardController.getLeaderboard.bind(leaderboardController),
        ),
    );

module.exports = router;
