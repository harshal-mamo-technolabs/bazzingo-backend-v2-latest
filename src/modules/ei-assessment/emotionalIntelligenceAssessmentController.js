const {
    CategoryAssessmentController,
} = require("../../common/controllers/categoryAssessmentController");
const { EI_MESSAGES } = require("../../constants");

class EmotionalIntelligenceAssessmentController extends CategoryAssessmentController {
    constructor(emotionalIntelligenceAssessmentService, logger) {
        super(emotionalIntelligenceAssessmentService, logger, {
            messages: EI_MESSAGES,
            paramName: "eiAssessmentId",
        });
    }
}

module.exports = { EmotionalIntelligenceAssessmentController };
