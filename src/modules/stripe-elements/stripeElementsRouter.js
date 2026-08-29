const express = require("express");
const logger = require("../../config/logger");
const { getStripe } = require("../../config/stripe");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { AssessmentService } = require("../assessment/assessmentService");
const { KlaviyoService } = require("../klaviyo/klaviyoService");
const { KlaviyoSyncService } = require("../lp/klaviyoSyncService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { StripeElementsController } = require("./stripeElementsController");
const { StripeElementsService } = require("./stripeElementsService");

const router = express.Router();

const stripe = getStripe();

const klaviyoSync = new KlaviyoSyncService(
    logger,
    new KlaviyoService(logger),
    new AssessmentService(logger),
    new LeaderboardService(logger),
    stripe,
);

const stripeElementsController = new StripeElementsController(
    new StripeElementsService(logger, stripe, klaviyoSync),
    logger,
);

const handler = (method) =>
    asyncWrapper(
        stripeElementsController[method].bind(stripeElementsController),
    );

router.route("/config").get(handler("getConfig"));
router.route("/default-config").get(handler("getDefaultConfig"));
router
    .route("/create-subscription")
    .post(requireAuth, handler("createSubscription"));
router
    .route("/activate-subscription")
    .post(requireAuth, handler("activateSubscription"));
router
    .route("/subscription-status/:subscriptionId")
    .get(requireAuth, handler("getSubscriptionStatus"));
router
    .route("/confirm-subscription")
    .post(requireAuth, handler("confirmSubscription"));
router
    .route("/cancel-subscription")
    .post(requireAuth, handler("cancelSubscription"));
router
    .route("/my-subscriptions")
    .get(requireAuth, handler("getUserSubscriptions"));
router.route("/create-payment").post(requireAuth, handler("createPayment"));
router
    .route("/payment-status/:orderId")
    .get(requireAuth, handler("getPaymentStatus"));
router.route("/confirm-payment").post(requireAuth, handler("confirmPayment"));
router.route("/my-orders").get(requireAuth, handler("getUserOrders"));
router.route("/quick-pay").post(requireAuth, handler("quickPay"));
router.route("/pay").post(requireAuth, handler("pay"));

module.exports = router;
