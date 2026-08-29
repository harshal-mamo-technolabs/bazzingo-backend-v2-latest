const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { StreakController } = require("./streakController");
const { StreakService } = require("./streakService");

const router = express.Router();

const streakController = new StreakController(
    new StreakService(logger),
    logger,
);

router.use(requireAuth);

router
    .route("/")
    .post(
        asyncWrapper(
            streakController.upsertDailyActivity.bind(streakController),
        ),
    )
    .get(asyncWrapper(streakController.getStreakData.bind(streakController)));

module.exports = router;
