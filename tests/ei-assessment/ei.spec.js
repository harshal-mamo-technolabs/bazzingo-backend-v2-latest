const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../src/app");
const EmotionalIntelligenceAssessment = require("../../src/modules/ei-assessment/emotionalIntelligenceAssessmentModel");
const EmotionalIntelligenceAssessmentScore = require("../../src/modules/ei-assessment/emotionalIntelligenceAssessmentScoreModel");
const EmotionalIntelligenceQuestionAndAnswer = require("../../src/modules/ei-assessment/emotionalIntelligenceQuestionAndAnswerModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

const SUB_CATEGORIES = ["self_awareness", "empathy"];

const createAssessment = (overrides = {}) =>
    EmotionalIntelligenceAssessment.create({
        title: "EI screener",
        description: "Screening",
        questions: 10,
        subCategories: SUB_CATEGORIES,
        ...overrides,
    });

describe("POST /assessment/emotional-intelligence", () => {
    useInMemoryDatabase();

    const validBody = {
        title: "EI screener",
        description: "Screening",
        questions: 10,
        subCategories: SUB_CATEGORIES,
    };

    const create = (body = validBody) =>
        request(app).post("/assessment/emotional-intelligence").send(body);

    it("should return a 201 without a token", async () => {
        const response = await create();

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe(
            "Emotional intelligence assessment created",
        );
    });

    it("should persist the assessment", async () => {
        await create();

        const assessment = await EmotionalIntelligenceAssessment.findOne({});
        expect(assessment.questions).toBe(10);
        expect(assessment.subCategories).toEqual(SUB_CATEGORIES);
    });

    it("should default the optional flags", async () => {
        await create();

        const assessment = await EmotionalIntelligenceAssessment.findOne({});
        expect(assessment.isAvailReport).toBe(true);
        expect(assessment.isAvailCertification).toBe(false);
        expect(assessment.active).toBe(true);
    });

    it("should default the title and description to empty strings", async () => {
        await create({ questions: 5, subCategories: SUB_CATEGORIES });

        const assessment = await EmotionalIntelligenceAssessment.findOne({});
        expect(assessment.title).toBe("");
        expect(assessment.description).toBe("");
    });

    it("should accept a priceCatalogId", async () => {
        const priceCatalogId = new mongoose.Types.ObjectId();

        await create({ ...validBody, priceCatalogId: String(priceCatalogId) });

        const assessment = await EmotionalIntelligenceAssessment.findOne({});
        expect(String(assessment.priceCatalogId)).toBe(String(priceCatalogId));
    });

    it("should return a 400 when questions is missing", async () => {
        const response = await create({ subCategories: SUB_CATEGORIES });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "questions and subCategories are required",
        );
    });

    it("should return a 400 when subCategories is empty", async () => {
        const response = await create({ questions: 10, subCategories: [] });

        expect(response.statusCode).toBe(400);
    });

    it("should return a 400 when questions is below 1", async () => {
        const response = await create({ ...validBody, questions: 0 });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("questions must be a number >= 1");
    });

    it("should return a 400 when questions is not a number", async () => {
        const response = await create({ ...validBody, questions: "ten" });

        expect(response.statusCode).toBe(400);
    });

    it("should return a 400 for a malformed priceCatalogId", async () => {
        const response = await create({
            ...validBody,
            priceCatalogId: "not-an-id",
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "priceCatalogId must be a valid ObjectId",
        );
    });
});

describe("POST /assessment/emotional-intelligence/:eiAssessmentId/questions", () => {
    useInMemoryDatabase();

    let assessment;

    beforeEach(async () => {
        assessment = await createAssessment();
    });

    const validQuestion = {
        subCategory: "self_awareness",
        questionType: "text",
        question: "I lose focus easily",
    };

    const addQuestions = (questions, id = assessment._id) =>
        request(app)
            .post(`/assessment/emotional-intelligence/${id}/questions`)
            .send({ questions });

    it("should return a 201 and the inserted count", async () => {
        const response = await addQuestions([validQuestion]);

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe(
            "Emotional intelligence questions added",
        );
        expect(response.body.data.count).toBe(1);
    });

    it("should persist the question", async () => {
        await addQuestions([validQuestion]);

        const question = await EmotionalIntelligenceQuestionAndAnswer.findOne(
            {},
        );
        expect(question.question).toBe("I lose focus easily");
        expect(question.subCategory).toBe("self_awareness");
    });

    it("should default optionScores", async () => {
        await addQuestions([validQuestion]);

        const question = await EmotionalIntelligenceQuestionAndAnswer.findOne(
            {},
        );
        expect(question.optionScores).toEqual([0, 1, 2, 3, 4]);
    });

    it("should honour explicit optionScores", async () => {
        await addQuestions([{ ...validQuestion, optionScores: [1, 2, 3] }]);

        const question = await EmotionalIntelligenceQuestionAndAnswer.findOne(
            {},
        );
        expect(question.optionScores).toEqual([1, 2, 3]);
    });

    it("should default isReverseScored to false", async () => {
        await addQuestions([validQuestion]);

        const question = await EmotionalIntelligenceQuestionAndAnswer.findOne(
            {},
        );
        expect(question.isReverseScored).toBe(false);
    });

    it("should default imageQuestionDescription to null", async () => {
        await addQuestions([validQuestion]);

        const question = await EmotionalIntelligenceQuestionAndAnswer.findOne(
            {},
        );
        expect(question.imageQuestionDescription).toBeNull();
    });

    it("should trim the question text", async () => {
        await addQuestions([{ ...validQuestion, question: "  spaced  " }]);

        const question = await EmotionalIntelligenceQuestionAndAnswer.findOne(
            {},
        );
        expect(question.question).toBe("spaced");
    });

    it("should return a 400 for a malformed assessment id", async () => {
        const response = await addQuestions([validQuestion], "not-an-id");

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Invalid assessment id");
    });

    it("should return a 404 for an unknown assessment", async () => {
        const response = await addQuestions(
            [validQuestion],
            new mongoose.Types.ObjectId(),
        );

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe(
            "Emotional intelligence assessment not found",
        );
    });

    it("should return a 400 when questions is not an array", async () => {
        const response = await addQuestions("nope");

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("questions array is required");
    });

    it("should return a 400 for a subCategory outside the assessment", async () => {
        const response = await addQuestions([
            { ...validQuestion, subCategory: "motivation" },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Invalid subCategory at index 0");
    });

    it("should return a 400 for an unknown questionType", async () => {
        const response = await addQuestions([
            { ...validQuestion, questionType: "audio" },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Invalid questionType at index 0");
    });

    it("should return a 400 for an empty question", async () => {
        const response = await addQuestions([
            { ...validQuestion, question: "   " },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Invalid question at index 0");
    });

    it("should return a 400 when quickAssessmentIds is not an array", async () => {
        const response = await addQuestions([
            { ...validQuestion, quickAssessmentIds: "nope" },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "quickAssessmentIds must be an array",
        );
    });

    it("should return a 400 for a malformed quickAssessmentIds entry", async () => {
        const response = await addQuestions([
            { ...validQuestion, quickAssessmentIds: ["nope"] },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "Each quickAssessmentIds entry must be a valid ObjectId",
        );
    });

    it("should return a 400 for a non numeric optionScores entry", async () => {
        const response = await addQuestions([
            { ...validQuestion, optionScores: [1, "two"] },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("optionScores[1] must be a number");
    });

    it("should return a 400 for an empty optionScores array", async () => {
        const response = await addQuestions([
            { ...validQuestion, optionScores: [] },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "optionScores must be a non-empty number array",
        );
    });

    it("should not insert anything when one question is invalid", async () => {
        await addQuestions([
            validQuestion,
            { ...validQuestion, subCategory: "motivation" },
        ]);

        expect(
            await EmotionalIntelligenceQuestionAndAnswer.countDocuments(),
        ).toBe(0);
    });
});

describe("GET /assessment/emotional-intelligence/:eiAssessmentId", () => {
    useInMemoryDatabase();

    const getById = (id) =>
        request(app).get(`/assessment/emotional-intelligence/${id}`);

    it("should return the assessment and its questions", async () => {
        const assessment = await createAssessment();
        await EmotionalIntelligenceQuestionAndAnswer.create({
            emotionalIntelligenceAssessmentId: assessment._id,
            subCategory: "self_awareness",
            questionType: "text",
            question: "I lose focus easily",
        });

        const response = await getById(assessment._id);

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Emotional intelligence assessment");
        expect(response.body.data.assessment.title).toBe("EI screener");
        expect(response.body.data.questions).toHaveLength(1);
    });

    it("should return an empty question list", async () => {
        const assessment = await createAssessment();

        const response = await getById(assessment._id);

        expect(response.body.data.questions).toEqual([]);
    });

    it("should return a 400 for a malformed id", async () => {
        const response = await getById("not-an-id");

        expect(response.statusCode).toBe(400);
    });

    it("should return a 404 for an unknown id", async () => {
        const response = await getById(new mongoose.Types.ObjectId());

        expect(response.statusCode).toBe(404);
    });
});

describe("POST /assessment/emotional-intelligence/submit", () => {
    useInMemoryDatabase();

    let user;
    let token;
    let assessment;

    beforeEach(async () => {
        user = await createUser({ name: "Harshal Chauhan", age: 27 });
        token = getAccessToken(user._id);
        assessment = await createAssessment();
    });

    const submit = (body) =>
        request(app)
            .post("/assessment/emotional-intelligence/submit")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    const validBody = () => ({
        assessmentId: String(assessment._id),
        answers: [
            { subCategory: "self_awareness", selectedOptionValue: 3 },
            { subCategory: "empathy", selectedOptionValue: 2 },
        ],
    });

    it("should return a 201 status code", async () => {
        const response = await submit(validBody());

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe(
            "Emotional intelligence assessment score submitted",
        );
    });

    it("should total the scores per category", async () => {
        const response = await submit(validBody());

        expect(response.body.data.byCategoryScores).toEqual({
            self_awareness: 3,
            empathy: 2,
        });
        expect(response.body.data.score.totalScore).toBe(5);
    });

    it("should sum repeated answers in the same category", async () => {
        const response = await submit({
            assessmentId: String(assessment._id),
            answers: [
                { subCategory: "self_awareness", selectedOptionValue: 2 },
                { subCategory: "self_awareness", selectedOptionValue: 3 },
            ],
        });

        expect(response.body.data.byCategoryScores.self_awareness).toBe(5);
    });

    it("should subtract a reversed answer", async () => {
        const response = await submit({
            assessmentId: String(assessment._id),
            answers: [
                { subCategory: "self_awareness", selectedOptionValue: 4 },
                {
                    subCategory: "self_awareness",
                    selectedOptionValue: 1,
                    isReversed: true,
                },
            ],
        });

        expect(response.body.data.byCategoryScores.self_awareness).toBe(3);
    });

    it("should floor a negative category at zero", async () => {
        const response = await submit({
            assessmentId: String(assessment._id),
            answers: [
                {
                    subCategory: "self_awareness",
                    selectedOptionValue: 4,
                    isReversed: true,
                },
            ],
        });

        expect(response.body.data.byCategoryScores.self_awareness).toBe(0);
        expect(response.body.data.score.totalScore).toBe(0);
    });

    it("should accept selectedValue as an alias", async () => {
        const response = await submit({
            assessmentId: String(assessment._id),
            answers: [{ subCategory: "self_awareness", selectedValue: 3 }],
        });

        expect(response.body.data.byCategoryScores.self_awareness).toBe(3);
    });

    it("should default the type to full", async () => {
        await submit(validBody());

        const score = await EmotionalIntelligenceAssessmentScore.findOne({
            userId: user._id,
        });
        expect(score.type).toBe("full");
    });

    it("should accept a quick submission", async () => {
        const response = await submit({ ...validBody(), type: "quick" });

        expect(response.body.data.submitType).toBe("quick");
    });

    it("should overwrite a resubmission of the same assessment", async () => {
        await submit(validBody());

        await submit({
            assessmentId: String(assessment._id),
            answers: [
                { subCategory: "self_awareness", selectedOptionValue: 1 },
            ],
        });

        const scores = await EmotionalIntelligenceAssessmentScore.find({
            userId: user._id,
        });
        expect(scores).toHaveLength(1);
        expect(scores[0].totalScore).toBe(1);
    });

    it("should keep full and quick submissions apart", async () => {
        await submit(validBody());

        await submit({ ...validBody(), type: "quick" });

        expect(
            await EmotionalIntelligenceAssessmentScore.countDocuments({
                userId: user._id,
            }),
        ).toBe(2);
    });

    it("should return a 400 for an unknown type", async () => {
        const response = await submit({ ...validBody(), type: "partial" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('type must be "full" or "quick"');
    });

    it("should return a 400 for a malformed assessmentId", async () => {
        const response = await submit({
            ...validBody(),
            assessmentId: "not-an-id",
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Valid assessmentId is required");
    });

    it("should return a 400 for empty answers", async () => {
        const response = await submit({
            assessmentId: String(assessment._id),
            answers: [],
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("answers must be a non-empty array");
    });

    it("should return a 400 for a missing subCategory", async () => {
        const response = await submit({
            assessmentId: String(assessment._id),
            answers: [{ selectedOptionValue: 3 }],
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "subCategory is required at index 0",
        );
    });

    it("should return a 400 for a non numeric answer", async () => {
        const response = await submit({
            assessmentId: String(assessment._id),
            answers: [
                { subCategory: "self_awareness", selectedOptionValue: "three" },
            ],
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "selectedOptionValue must be a finite number at index 0",
        );
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app)
            .post("/assessment/emotional-intelligence/submit")
            .send(validBody());

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /assessment/emotional-intelligence/report", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser({ name: "Harshal Chauhan", age: 27 });
        token = getAccessToken(user._id);
    });

    const addScore = (overrides = {}) =>
        EmotionalIntelligenceAssessmentScore.create({
            userId: user._id,
            type: "full",
            assessmentId: new mongoose.Types.ObjectId(),
            date: new Date(),
            totalScore: 12,
            byCategoryScores: { Self_Awareness: 7, empathy: 5 },
            ...overrides,
        });

    const getReports = () =>
        request(app)
            .get("/assessment/emotional-intelligence/report")
            .set("Authorization", `Bearer ${token}`);

    it("should return an empty report list", async () => {
        const response = await getReports();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Emotional intelligence full assessment reports",
        );
        expect(response.body.data.total).toBe(0);
    });

    it("should return the user info", async () => {
        const response = await getReports();

        expect(response.body.data.userInfo).toEqual({
            firstName: "Harshal",
            age: "27",
            country: "India",
        });
    });

    it("should return a report row per full score", async () => {
        await addScore();

        const response = await getReports();

        expect(response.body.data.total).toBe(1);
        expect(response.body.data.reports[0].totalScore).toBe(12);
    });

    it("should lowercase the category keys and pad the missing ones", async () => {
        await addScore();

        const response = await getReports();

        expect(response.body.data.reports[0].byCategoryScores).toEqual({
            self_awareness: 7,
            self_regulation: 0,
            empathy: 5,
            social_skills: 0,
            stress_management: 0,
            motivation: 0,
        });
    });

    it("should exclude quick scores", async () => {
        await addScore({ type: "quick" });

        const response = await getReports();

        expect(response.body.data.total).toBe(0);
    });

    it("should exclude another user's scores", async () => {
        const other = await createUser({ email: "other@bazzingo.com" });
        await addScore({ userId: other._id });

        const response = await getReports();

        expect(response.body.data.total).toBe(0);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get(
            "/assessment/emotional-intelligence/report",
        );

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /assessment/emotional-intelligence/:eiAssessmentId/report", () => {
    useInMemoryDatabase();

    let user;
    let token;
    let assessment;

    beforeEach(async () => {
        user = await createUser({ name: "Harshal Chauhan", age: 27 });
        token = getAccessToken(user._id);
        assessment = await createAssessment();
    });

    const addScore = (overrides = {}) =>
        EmotionalIntelligenceAssessmentScore.create({
            userId: user._id,
            type: "full",
            assessmentId: assessment._id,
            date: new Date(),
            totalScore: 9,
            byCategoryScores: { self_awareness: 9 },
            ...overrides,
        });

    const getReport = (id = assessment._id, query = "") =>
        request(app)
            .get(`/assessment/emotional-intelligence/${id}/report${query}`)
            .set("Authorization", `Bearer ${token}`);

    it("should return the report summary", async () => {
        await addScore();

        const response = await getReport();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Emotional intelligence assessment report summary",
        );
        expect(response.body.data.totalScore).toBe(9);
        expect(response.body.data.userInfo.firstName).toBe("Harshal");
    });

    it("should carry the assessment meta", async () => {
        const score = await addScore();

        const response = await getReport();

        expect(response.body.data.assessmentMeta.assessmentId).toBe(
            String(assessment._id),
        );
        expect(response.body.data.assessmentMeta.reportId).toBe(
            String(score._id),
        );
    });

    it("should read the quick score when type=quick", async () => {
        await addScore({
            type: "quick",
            totalScore: 4,
            byCategoryScores: { self_awareness: 4 },
        });

        const response = await getReport(assessment._id, "?type=quick");

        expect(response.body.data.totalScore).toBe(4);
    });

    it("should recompute the total from the known categories only", async () => {
        await addScore({
            totalScore: 999,
            byCategoryScores: { self_awareness: 5, unknown_category: 100 },
        });

        const response = await getReport();

        expect(response.body.data.totalScore).toBe(5);
        expect(
            response.body.data.byCategoryScores.unknown_category,
        ).toBeUndefined();
    });

    it("should treat an unknown type as full", async () => {
        await addScore();

        const response = await getReport(assessment._id, "?type=weird");

        expect(response.body.data.totalScore).toBe(9);
    });

    it("should return a 400 for a malformed id", async () => {
        const response = await getReport("not-an-id");

        expect(response.statusCode).toBe(400);
    });

    it("should return a 404 for an unknown assessment", async () => {
        const response = await getReport(new mongoose.Types.ObjectId());

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe(
            "Emotional intelligence assessment not found",
        );
    });

    it("should return a 404 when the user has no score", async () => {
        const response = await getReport();

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe(
            "No score found for this assessment",
        );
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get(
            `/assessment/emotional-intelligence/${assessment._id}/report`,
        );

        expect(response.statusCode).toBe(401);
    });
});
