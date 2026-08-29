const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const requireAdmin = require("../../common/middlewares/requireAdmin");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { BadgeController } = require("./badgeController");
const { BadgeService } = require("./badgeService");

const router = express.Router();

const badgeService = new BadgeService(logger);
const leaderboardService = new LeaderboardService(logger);
const badgeController = new BadgeController(
    badgeService,
    leaderboardService,
    logger,
);

router
    .route("/")
    .get(asyncWrapper(badgeController.getAllBadges.bind(badgeController)));

router
    .route("/ranks-and-badges")
    .get(
        requireAuth,
        asyncWrapper(
            badgeController.getUserRanksAndBadges.bind(badgeController),
        ),
    );

router
    .route("/bulk-insert")
    .post(
        requireAdmin(),
        asyncWrapper(badgeController.bulkInsertBadges.bind(badgeController)),
    );

module.exports = router;
