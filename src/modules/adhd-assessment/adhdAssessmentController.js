const {
    CategoryAssessmentController,
} = require("../../common/controllers/categoryAssessmentController");
const { ADHD_MESSAGES } = require("../../constants");

class AdhdAssessmentController extends CategoryAssessmentController {
    constructor(adhdAssessmentService, logger) {
        super(adhdAssessmentService, logger, {
            messages: ADHD_MESSAGES,
            paramName: "adhdAssessmentId",
        });
    }
}

module.exports = { AdhdAssessmentController };
