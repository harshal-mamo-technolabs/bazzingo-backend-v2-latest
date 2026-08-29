const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const logger = require("../../config/logger");
const { config } = require("../../config");
const { getStripe } = require("../../config/stripe");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { sendEmail } = require("../../common/utils/email");
const { BadgeService } = require("../badge/badgeService");
const { HelpscoutService } = require("../helpscout/helpscoutService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { AuthController } = require("./authController");
const { AuthService } = require("./authService");

const router = express.Router();

const authService = new AuthService(logger, {
    stripeClient: getStripe(),
    googleVerifier: new OAuth2Client(config.GOOGLE_CLIENT_ID),
    sendEmail,
});

const controller = new AuthController(
    authService,
    new LeaderboardService(logger),
    new BadgeService(logger),
    new HelpscoutService(logger),
    logger,
);

const handler = (method) => asyncWrapper(controller[method].bind(controller));

router.route("/signup").post(handler("signup"));

router.route("/signup-lp").post(handler("signupLp"));

router.route("/signup-msisdn").post(handler("signupMsisdn"));

router
    .route("/sync-assessment-submission-lp")
    .post(handler("syncAssessmentSubmissionLp"));

router.route("/refresh-token-lp").post(handler("refreshTokenLp"));

router.route("/login").post(handler("login"));

router.route("/login-msisdn").post(handler("loginMsisdn"));

router.route("/google-login").post(handler("googleLogin"));

router.route("/forgot-password").post(handler("forgotPassword"));

router.route("/forgot-password/:token").post(handler("resetPasswordWithToken"));

router.route("/reset-password").post(requireAuth, handler("resetPassword"));

module.exports = router;
