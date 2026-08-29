const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { UserController } = require("./userController");
const { UserService } = require("./userService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { getStripe } = require("../../config/stripe");
const {
    AdhdAssessmentService,
} = require("../adhd-assessment/adhdAssessmentService");
const {
    EmotionalIntelligenceAssessmentService,
} = require("../ei-assessment/emotionalIntelligenceAssessmentService");
const { AssessmentController } = require("../assessment/assessmentController");
const { AssessmentService } = require("../assessment/assessmentService");
const { generateQuickMinis } = require("../assessment/quickMiniGenerator");
const { BadgeService } = require("../badge/badgeService");
const { KlaviyoService } = require("../klaviyo/klaviyoService");
const { OrderService } = require("../stripe/orderService");
const { StreakService } = require("../streak/streakService");
const { UserAccountController } = require("./userAccountController");
const { UserDataService } = require("./userDataService");

const router = express.Router();

const leaderboardService = new LeaderboardService(logger);
const userService = new UserService(logger, leaderboardService);
const userController = new UserController(userService, logger);

const orderService = new OrderService(logger);

const userAccountController = new UserAccountController(
    new UserDataService(logger),
    new KlaviyoService(logger),
    getStripe(),
    logger,
);

const assessmentController = new AssessmentController(
    new AssessmentService(logger),
    leaderboardService,
    new BadgeService(logger),
    new StreakService(logger),
    new AdhdAssessmentService(logger, orderService),
    new EmotionalIntelligenceAssessmentService(logger, orderService),
    generateQuickMinis,
    logger,
);

router.use(requireAuth);

router
    .route("/")
    .get(asyncWrapper(userController.getProfile.bind(userController)))
    .put(asyncWrapper(userController.updateProfile.bind(userController)));

router
    .route("/preferences")
    .put(
        asyncWrapper(
            userController.updateNotificationPreferences.bind(userController),
        ),
    );

router
    .route("/subscription-and-assessments")
    .get(
        asyncWrapper(
            assessmentController.getUserSubscriptionAndAssessments.bind(
                assessmentController,
            ),
        ),
    );

router
    .route("/data-export")
    .get(
        asyncWrapper(
            userAccountController.exportUserData.bind(userAccountController),
        ),
    );

router
    .route("/delete-account")
    .post(
        asyncWrapper(
            userAccountController.deleteAccount.bind(userAccountController),
        ),
    );

module.exports = router;
