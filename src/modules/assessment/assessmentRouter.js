const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const requireAdmin = require("../../common/middlewares/requireAdmin");
const { asyncWrapper } = require("../../common/utils/wrapper");
const {
    AdhdAssessmentService,
} = require("../adhd-assessment/adhdAssessmentService");
const { BadgeService } = require("../badge/badgeService");
const {
    EmotionalIntelligenceAssessmentService,
} = require("../ei-assessment/emotionalIntelligenceAssessmentService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { OrderService } = require("../stripe/orderService");
const { StreakService } = require("../streak/streakService");
const { AssessmentController } = require("./assessmentController");
const { AssessmentService } = require("./assessmentService");
const { generateQuickMinis } = require("./quickMiniGenerator");

const router = express.Router();

const orderService = new OrderService(logger);

const controller = new AssessmentController(
    new AssessmentService(logger),
    new LeaderboardService(logger),
    new BadgeService(logger),
    new StreakService(logger),
    new AdhdAssessmentService(logger, orderService),
    new EmotionalIntelligenceAssessmentService(logger, orderService),
    generateQuickMinis,
    logger,
);

const handler = (method) => asyncWrapper(controller[method].bind(controller));

router
    .route("/")
    .get(requireAuth, handler("getFullAssessments"))
    .post(handler("createFullAssessment"));

router
    .route("/:fullAssessmentId/questions")
    .post(handler("addFullAssessmentQuestions"));

router
    .route("/:fullAssessmentId/generate-quick")
    .post(handler("generateQuickMiniAssessments"));

router.route("/quick/:id").get(handler("getQuickMiniAssessmentById"));

router.route("/submit").post(requireAuth, handler("submitAssessmentScore"));

router.route("/quick").get(requireAuth, handler("getTodaysAssignedQuick"));

router
    .route("/recent-activity")
    .get(requireAuth, handler("getLatestAssessmentScores"));

router
    .route("/program-score")
    .get(requireAuth, handler("getUserProgramScores"));

router
    .route("/program-scores-only")
    .get(requireAuth, handler("getUserProgramScoresOnly"));

router.route("/score/:scoreId").get(handler("getAssessmentScorePublic"));

router
    .route("/subscription-and-assessments")
    .get(requireAuth, handler("getUserSubscriptionAndAssessments"));

router
    .route("/statistics")
    .get(requireAuth, handler("getAssessmentStatistics"));

router
    .route("/daily-assessment-purchase-recommendation")
    .get(requireAuth, handler("getDailyRecommendedAssessment"));

router
    .route("/current-mini-assessment-purchase-status")
    .get(requireAuth, handler("getCurrentMiniAssessmentWithPurchaseStatus"));

router
    .route("/user/full-scores")
    .get(requireAuth, handler("getUserFullAssessmentScores"));

router
    .route("/user/submitted-full-assessments")
    .get(requireAuth, handler("getUserSubmittedFullAssessments"));

router
    .route("/attach-price")
    .post(requireAdmin(), handler("attachAssessmentPrice"));

router.route("/:id").get(handler("getFullAssessmentById"));

module.exports = router;
