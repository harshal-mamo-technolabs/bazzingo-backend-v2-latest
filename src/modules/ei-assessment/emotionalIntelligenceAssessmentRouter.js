const express = require("express");
const logger = require("../../config/logger");
const { requireAuth } = require("../../common/middlewares/authenticate");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { OrderService } = require("../stripe/orderService");
const {
    EmotionalIntelligenceAssessmentController,
} = require("./emotionalIntelligenceAssessmentController");
const {
    EmotionalIntelligenceAssessmentService,
} = require("./emotionalIntelligenceAssessmentService");

const router = express.Router();

const controller = new EmotionalIntelligenceAssessmentController(
    new EmotionalIntelligenceAssessmentService(
        logger,
        new OrderService(logger),
    ),
    logger,
);

const handler = (method) => asyncWrapper(controller[method].bind(controller));

router.route("/").post(handler("createAssessment"));

router.route("/submit").post(requireAuth, handler("submitAssessmentScore"));

router.route("/report").get(requireAuth, handler("getAssessmentReportsList"));

router
    .route("/:eiAssessmentId/questions")
    .post(handler("addAssessmentQuestions"));

router
    .route("/:eiAssessmentId/report")
    .get(requireAuth, handler("getAssessmentReportSummary"));

router.route("/:eiAssessmentId").get(handler("getAssessmentById"));

module.exports = router;
