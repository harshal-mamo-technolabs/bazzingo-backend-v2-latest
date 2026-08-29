const {
    CategoryAssessmentService,
} = require("../../common/services/categoryAssessmentService");
const { EI_REPORT_CATEGORY_KEYS } = require("../../constants");
const EmotionalIntelligenceAssessment = require("./emotionalIntelligenceAssessmentModel");
const EmotionalIntelligenceAssessmentScore = require("./emotionalIntelligenceAssessmentScoreModel");
const EmotionalIntelligenceQuestionAndAnswer = require("./emotionalIntelligenceQuestionAndAnswerModel");

class EmotionalIntelligenceAssessmentService extends CategoryAssessmentService {
    constructor(logger, orderService) {
        super(logger, orderService, {
            assessmentModel: EmotionalIntelligenceAssessment,
            scoreModel: EmotionalIntelligenceAssessmentScore,
            questionModel: EmotionalIntelligenceQuestionAndAnswer,
            foreignKey: "emotionalIntelligenceAssessmentId",
            categoryKeys: EI_REPORT_CATEGORY_KEYS,
        });
    }
}

module.exports = { EmotionalIntelligenceAssessmentService };
