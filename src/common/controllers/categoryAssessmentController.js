const mongoose = require("mongoose");
const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const {
    normalizeImageDescription,
    parseQuickAssessmentIds,
    normalizeOptionScores,
    shapeUserInfo,
} = require("../../common/utils/assessmentInput");
const {
    RESPONSE_STATUS,
    ASSESSMENT_TYPES,
    ASSESSMENT_MESSAGES,
    QUESTION_TYPES,
} = require("../../constants");
const User = require("../../modules/user/userModel");

class CategoryAssessmentController {
    constructor(service, logger, { messages, paramName }) {
        this.service = service;
        this.logger = logger;
        this.messages = messages;
        this.paramName = paramName;
    }

    async createAssessment(req, res, next) {
        const {
            title,
            description,
            questions,
            subCategories,
            priceCatalogId,
            isAvailReport = true,
            isAvailCertification = false,
            active = true,
        } = req.body;

        this.logger.info("Request to create a category assessment", {
            requestId: req.requestId,
        });

        if (
            (questions !== 0 && !questions) ||
            !Array.isArray(subCategories) ||
            subCategories.length === 0
        ) {
            this.logger.warn("category assessment creation failed validation", {
                requestId: req.requestId,
            });
            return next(createHttpError(400, this.messages.CREATE_REQUIRED));
        }

        const questionsCount = Number(questions);

        if (!Number.isFinite(questionsCount) || questionsCount < 1) {
            return next(
                createHttpError(400, ASSESSMENT_MESSAGES.QUESTIONS_MIN),
            );
        }

        if (
            priceCatalogId !== undefined &&
            priceCatalogId !== null &&
            !mongoose.isValidObjectId(priceCatalogId)
        ) {
            return next(
                createHttpError(400, ASSESSMENT_MESSAGES.PRICE_CATALOG_INVALID),
            );
        }

        const assessment = await this.service.create({
            title: title ?? "",
            description: description ?? "",
            questions: questionsCount,
            subCategories,
            priceCatalogId,
            isAvailReport,
            isAvailCertification,
            active,
        });

        this.logger.info("category assessment created", {
            requestId: req.requestId,
            assessmentId: String(assessment._id),
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: this.messages.CREATED,
            data: { assessment },
        });
    }

    async addAssessmentQuestions(req, res, next) {
        const assessmentIdParam = req.params[this.paramName];
        const { questions } = req.body;

        this.logger.info("Request to add category assessment questions", {
            requestId: req.requestId,
            assessmentId: assessmentIdParam,
        });

        if (!mongoose.isValidObjectId(assessmentIdParam)) {
            return next(
                createHttpError(400, ASSESSMENT_MESSAGES.INVALID_ASSESSMENT_ID),
            );
        }

        if (!Array.isArray(questions) || questions.length === 0) {
            return next(
                createHttpError(400, ASSESSMENT_MESSAGES.QUESTIONS_REQUIRED),
            );
        }

        const assessment = await this.service.findById(assessmentIdParam);

        if (!assessment) {
            return next(createHttpError(404, this.messages.NOT_FOUND));
        }

        const allowedSubs = new Set(
            (assessment.subCategories || []).map((sub) => String(sub)),
        );

        const prepared = questions.map((question, index) => {
            if (
                !question.subCategory ||
                !allowedSubs.has(String(question.subCategory))
            ) {
                throw createHttpError(
                    400,
                    `Invalid subCategory at index ${index}`,
                );
            }

            if (
                !question.questionType ||
                !QUESTION_TYPES.includes(String(question.questionType))
            ) {
                throw createHttpError(
                    400,
                    `Invalid questionType at index ${index}`,
                );
            }

            if (!question.question || String(question.question).trim() === "") {
                throw createHttpError(
                    400,
                    `Invalid question at index ${index}`,
                );
            }

            const optionScores = normalizeOptionScores(question.optionScores);

            const row = {
                [this.service.foreignKey]: assessmentIdParam,
                quickAssessmentIds: parseQuickAssessmentIds(
                    question.quickAssessmentIds,
                ),
                subCategory: String(question.subCategory).trim(),
                questionType: question.questionType,
                imageQuestionDescription: normalizeImageDescription(
                    question.imageQuestionDescription,
                ),
                question: String(question.question).trim(),
                isReverseScored:
                    typeof question.isReverseScored === "boolean"
                        ? question.isReverseScored
                        : Boolean(question.isReverseScored),
            };

            if (optionScores !== undefined) {
                row.optionScores = optionScores;
            }

            return row;
        });

        const inserted = await this.service.addQuestions(prepared);

        this.logger.info("category assessment questions added", {
            requestId: req.requestId,
            assessmentId: assessmentIdParam,
            count: inserted.length,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: this.messages.QUESTIONS_ADDED,
            data: { count: inserted.length },
        });
    }

    async getAssessmentById(req, res, next) {
        const assessmentIdParam = req.params[this.paramName];

        this.logger.info("Request to read a category assessment", {
            requestId: req.requestId,
            assessmentId: assessmentIdParam,
        });

        if (!mongoose.isValidObjectId(assessmentIdParam)) {
            return next(
                createHttpError(400, ASSESSMENT_MESSAGES.INVALID_ASSESSMENT_ID),
            );
        }

        const assessment = await this.service.findById(assessmentIdParam);

        if (!assessment) {
            return next(createHttpError(404, this.messages.NOT_FOUND));
        }

        const questions = await this.service.findQuestions(assessmentIdParam);

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: this.messages.FETCHED,
            data: { assessment, questions },
        });
    }

    async getAssessmentReportSummary(req, res, next) {
        const assessmentIdParam = req.params[this.paramName];
        const type =
            req.query?.type === ASSESSMENT_TYPES.QUICK
                ? ASSESSMENT_TYPES.QUICK
                : ASSESSMENT_TYPES.FULL;

        this.logger.info(
            "Request to read an category assessment report summary",
            {
                requestId: req.requestId,
                userId: String(req.user._id),
                assessmentId: assessmentIdParam,
                type,
            },
        );

        if (!mongoose.isValidObjectId(assessmentIdParam)) {
            return next(
                createHttpError(400, ASSESSMENT_MESSAGES.INVALID_ASSESSMENT_ID),
            );
        }

        if (type === ASSESSMENT_TYPES.FULL) {
            const assessment = await this.service.findById(assessmentIdParam);

            if (!assessment) {
                return next(createHttpError(404, this.messages.NOT_FOUND));
            }
        }

        const score = await this.service.findScore({
            userId: req.user._id,
            assessmentId: assessmentIdParam,
            type,
        });

        if (!score) {
            this.logger.warn(
                "No category assessment score for this assessment",
                {
                    requestId: req.requestId,
                    userId: String(req.user._id),
                    assessmentId: assessmentIdParam,
                },
            );
            return next(createHttpError(404, ASSESSMENT_MESSAGES.NO_SCORE));
        }

        const user = await User.findById(req.user._id)
            .select("name firstName age country")
            .lean();

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: this.messages.REPORT_SUMMARY,
            data: {
                ...this.service.buildReportRow(score),
                userInfo: shapeUserInfo(user),
            },
        });
    }

    async getAssessmentReportsList(req, res) {
        this.logger.info("Request to list the category assessment reports", {
            requestId: req.requestId,
            userId: String(req.user._id),
        });

        const scores = await this.service.findFullScores(req.user._id);

        const user = await User.findById(req.user._id)
            .select("name firstName age country")
            .lean();

        const reports = scores.map((score) =>
            this.service.buildReportRow(score),
        );

        this.logger.info("category assessment reports sent", {
            requestId: req.requestId,
            userId: String(req.user._id),
            total: reports.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: this.messages.REPORTS_LIST,
            data: {
                total: reports.length,
                userInfo: shapeUserInfo(user),
                reports,
            },
        });
    }

    async submitAssessmentScore(req, res, next) {
        const {
            assessmentId,
            type = ASSESSMENT_TYPES.FULL,
            answers,
        } = req.body;

        this.logger.info("Request to submit an category assessment score", {
            requestId: req.requestId,
            userId: String(req.user._id),
            assessmentId,
            type,
        });

        if (![ASSESSMENT_TYPES.FULL, ASSESSMENT_TYPES.QUICK].includes(type)) {
            return next(createHttpError(400, ASSESSMENT_MESSAGES.INVALID_TYPE));
        }

        if (!assessmentId || !mongoose.isValidObjectId(assessmentId)) {
            return next(
                createHttpError(
                    400,
                    ASSESSMENT_MESSAGES.ASSESSMENT_ID_REQUIRED,
                ),
            );
        }

        if (!Array.isArray(answers) || answers.length === 0) {
            return next(
                createHttpError(400, ASSESSMENT_MESSAGES.ANSWERS_REQUIRED),
            );
        }

        const rawByCategory = {};

        answers.forEach((answer, index) => {
            const subCategory = String(answer?.subCategory ?? "").trim();

            if (!subCategory) {
                throw createHttpError(
                    400,
                    `subCategory is required at index ${index}`,
                );
            }

            const selectedOptionValue =
                answer.selectedOptionValue !== undefined
                    ? answer.selectedOptionValue
                    : answer.selectedValue;
            const optionPoints = Number(selectedOptionValue);

            if (!Number.isFinite(optionPoints)) {
                throw createHttpError(
                    400,
                    `selectedOptionValue must be a finite number at index ${index}`,
                );
            }

            const delta = answer.isReversed ? -optionPoints : optionPoints;
            rawByCategory[subCategory] =
                (rawByCategory[subCategory] || 0) + delta;
        });

        const byCategoryScores = {};
        let totalScore = 0;

        for (const category of Object.keys(rawByCategory)) {
            const floored = Math.max(0, rawByCategory[category]);
            byCategoryScores[category] = floored;
            totalScore += floored;
        }

        const score = await this.service.saveScore({
            userId: req.user._id,
            type,
            assessmentId,
            totalScore,
            byCategoryScores,
        });

        this.logger.info("category assessment score submitted", {
            requestId: req.requestId,
            userId: String(req.user._id),
            assessmentId,
            totalScore,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: this.messages.SCORE_SUBMITTED,
            data: { score, byCategoryScores, submitType: type },
        });
    }
}

module.exports = { CategoryAssessmentController };
