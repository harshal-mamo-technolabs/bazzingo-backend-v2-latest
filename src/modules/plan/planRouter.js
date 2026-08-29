const express = require("express");
const logger = require("../../config/logger");
const { getStripe } = require("../../config/stripe");
const requireAdmin = require("../../common/middlewares/requireAdmin");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { PlanController } = require("./planController");
const { PlanService } = require("./planService");

const router = express.Router();

const planController = new PlanController(
    new PlanService(logger, getStripe()),
    logger,
);

const handler = (method) =>
    asyncWrapper(planController[method].bind(planController));

router
    .route("/")
    .post(requireAdmin(), handler("createPlan"))
    .get(handler("listPlans"));

router
    .route("/attach-prices")
    .post(requireAdmin(), handler("attachPlanPrices"));

router
    .route("/create-direct-plan")
    .post(requireAdmin(), handler("createDirectPlan"));

router
    .route("/:planId/attach-price")
    .post(requireAdmin(), handler("attachPriceToPlan"));

module.exports = router;
