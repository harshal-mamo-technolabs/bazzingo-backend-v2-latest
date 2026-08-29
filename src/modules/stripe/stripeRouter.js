const express = require("express");
const logger = require("../../config/logger");
const { getStripe } = require("../../config/stripe");
const { sendEmail } = require("../../common/utils/email");
const requireAdmin = require("../../common/middlewares/requireAdmin");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { AssessmentService } = require("../assessment/assessmentService");
const { KlaviyoService } = require("../klaviyo/klaviyoService");
const { KlaviyoSyncService } = require("../lp/klaviyoSyncService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { StripeController } = require("./stripeController");
const { StripeService } = require("./stripeService");

const router = express.Router();

const stripe = getStripe();

const klaviyoSync = new KlaviyoSyncService(
    logger,
    new KlaviyoService(logger),
    new AssessmentService(logger),
    new LeaderboardService(logger),
    stripe,
);

const stripeController = new StripeController(
    new StripeService(logger, stripe, klaviyoSync, sendEmail),
    logger,
);

const handler = (method) =>
    asyncWrapper(stripeController[method].bind(stripeController));

router.route("/prices").post(requireAdmin(), handler("createPrice"));

router
    .route("/checkout/session")
    .post(requireAuth, handler("createCheckoutOrOneClick"));

router.route("/subscription").post(requireAuth, handler("createSubscription"));

router
    .route("/subscription/confirm")
    .post(requireAuth, handler("confirmSubscription"));

router
    .route("/subscription/status")
    .get(requireAuth, handler("getSubscriptionStatus"));

router.route("/session/check").get(requireAuth, handler("checkSessionAndPlan"));

router
    .route("/user/subscription-status")
    .get(requireAuth, handler("getUserSubscriptionStatus"));

router
    .route("/subscription/cancel")
    .post(requireAuth, handler("cancelSubscription"));

router.route("/invoices").get(requireAuth, handler("getInvoices"));

router
    .route("/end-trial-pro")
    .post(requireAuth, handler("completeTrialTransition"));

router
    .route("/assessment-id")
    .get(requireAuth, handler("getAssessmentIdBySessionOrOrder"));

module.exports = router;
