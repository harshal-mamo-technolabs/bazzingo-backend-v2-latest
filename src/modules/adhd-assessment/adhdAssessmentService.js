const {
    CategoryAssessmentService,
} = require("../../common/services/categoryAssessmentService");
const { ADHD_REPORT_CATEGORY_KEYS } = require("../../constants");
const AdhdAssessment = require("./adhdAssessmentModel");
const AdhdAssessmentScore = require("./adhdAssessmentScoreModel");
const AdhdQuestionAndAnswer = require("./adhdQuestionAndAnswerModel");

class AdhdAssessmentService extends CategoryAssessmentService {
    constructor(logger, orderService) {
        super(logger, orderService, {
            assessmentModel: AdhdAssessment,
            scoreModel: AdhdAssessmentScore,
            questionModel: AdhdQuestionAndAnswer,
            foreignKey: "adhdAssessmentId",
            categoryKeys: ADHD_REPORT_CATEGORY_KEYS,
        });
    }
}

module.exports = { AdhdAssessmentService };
