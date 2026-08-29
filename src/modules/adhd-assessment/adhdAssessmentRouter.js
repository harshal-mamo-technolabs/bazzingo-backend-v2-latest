const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { OrderService } = require("../stripe/orderService");
const { AdhdAssessmentController } = require("./adhdAssessmentController");
const { AdhdAssessmentService } = require("./adhdAssessmentService");

const router = express.Router();

const controller = new AdhdAssessmentController(
    new AdhdAssessmentService(logger, new OrderService(logger)),
    logger,
);

const handler = (method) => asyncWrapper(controller[method].bind(controller));

router.route("/").post(handler("createAssessment"));

router.route("/submit").post(requireAuth, handler("submitAssessmentScore"));

router.route("/report").get(requireAuth, handler("getAssessmentReportsList"));

router
    .route("/:adhdAssessmentId/questions")
    .post(handler("addAssessmentQuestions"));

router
    .route("/:adhdAssessmentId/report")
    .get(requireAuth, handler("getAssessmentReportSummary"));

router.route("/:adhdAssessmentId").get(handler("getAssessmentById"));

module.exports = router;
