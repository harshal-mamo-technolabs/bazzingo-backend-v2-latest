const express = require("express");
const { config } = require("../../config");
const logger = require("../../config/logger");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const { KlaviyoSyncService } = require("../lp/klaviyoSyncService");
const { KlaviyoService } = require("../klaviyo/klaviyoService");
const { AssessmentService } = require("../assessment/assessmentService");
const { getStripe } = require("../../config/stripe");
const { sendEmail } = require("../../common/utils/email");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { StripeService } = require("./stripeService");
const { StripeWebhookController } = require("./stripeWebhookController");

const router = express.Router();

const stripe = getStripe();

const klaviyoSync = new KlaviyoSyncService(
    logger,
    new KlaviyoService(logger),
    new AssessmentService(logger),
    new LeaderboardService(logger),
    stripe,
);

const stripeWebhookController = new StripeWebhookController(
    new StripeService(logger, stripe, klaviyoSync, sendEmail),
    logger,
    stripe,
    config.STRIPE_WEBHOOK_KEY,
);

router
    .route("/")
    .post(
        express.raw({ type: "application/json" }),
        asyncWrapper(
            stripeWebhookController.webhook.bind(stripeWebhookController),
        ),
    );

module.exports = router;
