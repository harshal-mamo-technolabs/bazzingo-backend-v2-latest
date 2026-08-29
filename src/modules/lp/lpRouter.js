const express = require("express");
const logger = require("../../config/logger");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { AssessmentService } = require("../assessment/assessmentService");
const { BadgeService } = require("../badge/badgeService");
const { HelpscoutService } = require("../helpscout/helpscoutService");
const { KlaviyoService } = require("../klaviyo/klaviyoService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { KlaviyoSyncService } = require("./klaviyoSyncService");
const { LpController } = require("./lpController");
const { LpService } = require("./lpService");

const router = express.Router();

const assessmentService = new AssessmentService(logger);
const leaderboardService = new LeaderboardService(logger);
const klaviyoService = new KlaviyoService(logger);

const controller = new LpController(
    new LpService(logger),
    assessmentService,
    new KlaviyoSyncService(
        logger,
        klaviyoService,
        assessmentService,
        leaderboardService,
    ),
    klaviyoService,
    leaderboardService,
    new BadgeService(logger),
    new HelpscoutService(logger),
    logger,
);

const handler = (method) => asyncWrapper(controller[method].bind(controller));

router
    .route("/assessment/:assessmentId/quick")
    .get(handler("getQuickAssessmentById"));

router
    .route("/assessment/submit-score")
    .post(handler("submitQuickAssessmentScoreLp"));

router.route("/hook/create").post(handler("createLpHook"));

router.route("/hook/update/:uuid").patch(handler("updateLpHook"));

router.route("/hook/resume/:uuid").get(handler("resumeLpHook"));

module.exports = router;
