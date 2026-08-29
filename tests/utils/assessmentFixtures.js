const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const QuestionAndAnswer = require("../../src/modules/assessment/questionAndAnswerModel");
const QuickMiniAssessment = require("../../src/modules/assessment/quickMiniAssessmentModel");
const AssessmentScore = require("../../src/modules/assessment/assessmentScoreModel");
const Order = require("../../src/modules/stripe/orderModel");

const SUBCATEGORIES = ["logic", "memory"];

const createFullAssessment = (overrides = {}) =>
    FullAssessment.create({
        mainCategory: "iq-test",
        title: "IQ Test",
        description: "Full IQ test",
        questions: 4,
        fixedPoint: 5,
        subcategories: SUBCATEGORIES,
        stripeProductId: "prod_iq",
        ...overrides,
    });

const createQuestion = (fullAssessment, overrides = {}) =>
    QuestionAndAnswer.create({
        fullAssessment: fullAssessment._id,
        subcategory: "logic",
        questionType: "text",
        question: "2 + 2 = ?",
        optionsType: "text",
        options: ["1", "2", "3", "4"],
        answerIndex: 3,
        points: 5,
        ...overrides,
    });

const createQuickMini = (fullAssessment, questions, overrides = {}) =>
    QuickMiniAssessment.create({
        fullAssessment: fullAssessment._id,
        questions: questions.map((question) => question._id),
        size: questions.length,
        order: 1,
        ...overrides,
    });

const createScore = (user, overrides = {}) =>
    AssessmentScore.create({
        userId: user._id,
        type: "full",
        assessmentId: overrides.assessmentId,
        mainCategory: "iq-test",
        date: new Date(),
        totalScore: 10,
        byCategory: { logic: 10 },
        ...overrides,
    });

const purchaseAssessment = (user, assessment, overrides = {}) =>
    Order.create({
        userId: user._id,
        assessmentId: assessment._id,
        status: "succeeded",
        ...overrides,
    });

module.exports = {
    SUBCATEGORIES,
    createFullAssessment,
    createQuestion,
    createQuickMini,
    createScore,
    purchaseAssessment,
};
