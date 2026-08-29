const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const assessmentRouter = require("../../src/modules/assessment/assessmentRouter");
const FullAssessment = require("../../src/modules/assessment/fullAssessmentModel");
const QuestionAndAnswer = require("../../src/modules/assessment/questionAndAnswerModel");
const QuickMiniAssessment = require("../../src/modules/assessment/quickMiniAssessmentModel");
const { useInMemoryDatabase } = require("../utils/db");
const {
    createAdmin,
    createUser,
    getAccessToken,
    getAdminToken,
} = require("../utils/fixtures");
const {
    SUBCATEGORIES,
    createFullAssessment,
    createQuestion,
    createQuickMini,
} = require("../utils/assessmentFixtures");

const app = express();
app.use(express.json());
app.use(requestLogger);
app.use("/assessment", assessmentRouter);
app.use(globalErrorHandler);

describe("POST /assessment", () => {
    useInMemoryDatabase();

    const validBody = {
        mainCategory: "IQ-Test",
        questions: 10,
        subcategories: SUBCATEGORIES,
        title: "IQ Test",
        stripeProductId: "prod_iq",
    };

    const create = (body = validBody) =>
        request(app).post("/assessment").send(body);

    it("should return a 201 without a token", async () => {
        const response = await create();

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe("Full assessment created");
    });

    it("should lowercase and trim the main category", async () => {
        await create({ ...validBody, mainCategory: "  IQ-Test  " });

        const assessment = await FullAssessment.findOne({});
        expect(assessment.mainCategory).toBe("iq-test");
    });

    it("should default the optional fields", async () => {
        await create({
            mainCategory: "iq-test",
            questions: 10,
            subcategories: SUBCATEGORIES,
            stripeProductId: "prod_iq",
        });

        const assessment = await FullAssessment.findOne({});
        expect(assessment.title).toBe("");
        expect(assessment.description).toBe("");
        expect(assessment.fixedPoint).toBe(5);
        expect(assessment.isAvailReport).toBe(true);
        expect(assessment.isAvailCertification).toBe(false);
    });

    it("should return a 400 when the main category is missing", async () => {
        const { mainCategory, ...body } = validBody;

        const response = await create(body);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "mainCategory, questions and subcategories are required",
        );
    });

    it("should return a 400 when subcategories is empty", async () => {
        const response = await create({ ...validBody, subcategories: [] });

        expect(response.statusCode).toBe(400);
    });

    it("should return a 400 when questions is below 1", async () => {
        const response = await create({ ...validBody, questions: 0 });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("questions must be a number >= 1");
    });

    it("should return a 400 when stripeProductId is missing", async () => {
        const { stripeProductId, ...body } = validBody;

        const response = await create(body);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("stripeProductId is required");
    });

    it("should return a 400 when stripeProductId is blank", async () => {
        const response = await create({ ...validBody, stripeProductId: "   " });

        expect(response.statusCode).toBe(400);
    });
});

describe("POST /assessment/:fullAssessmentId/questions", () => {
    useInMemoryDatabase();

    let assessment;

    beforeEach(async () => {
        assessment = await createFullAssessment();
    });

    const validQuestion = {
        subcategory: "logic",
        questionType: "text",
        question: "2 + 2 = ?",
        optionsType: "text",
        options: ["1", "2", "3", "4"],
        answerIndex: 3,
    };

    const addQuestions = (questions, id = assessment._id) =>
        request(app).post(`/assessment/${id}/questions`).send({ questions });

    it("should return a 201 and the count", async () => {
        const response = await addQuestions([validQuestion]);

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe("Questions added");
        expect(response.body.data.count).toBe(1);
    });

    it("should default the points to the assessment fixedPoint", async () => {
        await addQuestions([validQuestion]);

        const question = await QuestionAndAnswer.findOne({});
        expect(question.points).toBe(5);
    });

    it("should honour explicit points", async () => {
        await addQuestions([{ ...validQuestion, points: 9 }]);

        const question = await QuestionAndAnswer.findOne({});
        expect(question.points).toBe(9);
    });

    it("should default imageQuestionDescription to null", async () => {
        await addQuestions([validQuestion]);

        const question = await QuestionAndAnswer.findOne({});
        expect(question.imageQuestionDescription).toBeNull();
    });

    it("should return a 404 for an unknown assessment", async () => {
        const response = await addQuestions(
            [validQuestion],
            new mongoose.Types.ObjectId(),
        );

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Full assessment not found");
    });

    it("should return a 400 when questions is not an array", async () => {
        const response = await addQuestions("nope");

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("questions array is required");
    });

    it("should return a 400 for a subcategory outside the assessment", async () => {
        const response = await addQuestions([
            { ...validQuestion, subcategory: "speed" },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Invalid subcategory at index 0");
    });

    it("should return a 400 when options is not exactly four", async () => {
        const response = await addQuestions([
            { ...validQuestion, options: ["1", "2", "3"] },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "Invalid question payload at index 0",
        );
    });

    it("should return a 400 for an answerIndex out of range", async () => {
        const response = await addQuestions([
            { ...validQuestion, answerIndex: 4 },
        ]);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Invalid answerIndex at index 0");
    });

    it("should return a 400 for a non numeric answerIndex", async () => {
        const response = await addQuestions([
            { ...validQuestion, answerIndex: "3" },
        ]);

        expect(response.statusCode).toBe(400);
    });

    it("should not insert anything when one question is invalid", async () => {
        await addQuestions([
            validQuestion,
            { ...validQuestion, subcategory: "speed" },
        ]);

        expect(await QuestionAndAnswer.countDocuments()).toBe(0);
    });
});

describe("POST /assessment/:fullAssessmentId/generate-quick", () => {
    useInMemoryDatabase();

    let assessment;

    beforeEach(async () => {
        assessment = await createFullAssessment();

        for (let i = 0; i < 20; i += 1) {
            await createQuestion(assessment, {
                subcategory: i % 2 === 0 ? "logic" : "memory",
                question: `Question ${i}`,
            });
        }
    });

    const generate = (query = "", id = assessment._id) =>
        request(app).post(`/assessment/${id}/generate-quick${query}`);

    it("should return a 201 and generate four minis by default", async () => {
        const response = await generate();

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe("Quick mini assessments generated");
        expect(response.body.data.createdCount).toBe(4);
    });

    it("should honour the count query", async () => {
        const response = await generate("?count=2");

        expect(response.body.data.createdCount).toBe(2);
    });

    it("should clamp a count below 1 up to 1", async () => {
        const response = await generate("?count=0");

        expect(response.body.data.createdCount).toBe(4);
    });

    it("should persist the minis with ascending order", async () => {
        await generate("?count=2");

        const minis = await QuickMiniAssessment.find({}).sort({ order: 1 });
        expect(minis).toHaveLength(2);
        expect(minis.map((mini) => mini.order)).toEqual([1, 2]);
    });

    it("should continue the order on a second run", async () => {
        await generate("?count=1");

        await generate("?count=1");

        const minis = await QuickMiniAssessment.find({}).sort({ order: 1 });
        expect(minis.map((mini) => mini.order)).toEqual([1, 2]);
    });

    it("should link each question back to its mini", async () => {
        await generate("?count=1");

        const mini = await QuickMiniAssessment.findOne({});
        const linked = await QuestionAndAnswer.find({
            quickAssessment: mini._id,
        });
        expect(linked.length).toBe(mini.questions.length);
    });

    it("should return a 404 for an unknown assessment", async () => {
        const response = await generate("", new mongoose.Types.ObjectId());

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Full assessment not found");
    });

    it("should return a 400 when the assessment has no questions", async () => {
        const empty = await createFullAssessment({ title: "Empty" });

        const response = await generate("", empty._id);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("No questions found");
    });

    it("should return a 400 when the assessment has no subcategories", async () => {
        const empty = await createFullAssessment({
            title: "No subs",
            subcategories: [],
        });

        const response = await generate("", empty._id);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("No subcategories defined");
    });
});

describe("GET /assessment/:id", () => {
    useInMemoryDatabase();

    it("should return the assessment and its questions", async () => {
        const assessment = await createFullAssessment();
        await createQuestion(assessment);

        const response = await request(app).get(
            `/assessment/${assessment._id}`,
        );

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Full assessment");
        expect(response.body.data.assessment.title).toBe("IQ Test");
        expect(response.body.data.questions).toHaveLength(1);
    });

    it("should return a 404 for an unknown id", async () => {
        const response = await request(app).get(
            `/assessment/${new mongoose.Types.ObjectId()}`,
        );

        expect(response.statusCode).toBe(404);
    });
});

describe("GET /assessment/quick/:id", () => {
    useInMemoryDatabase();

    it("should return the mini and its questions in order", async () => {
        const assessment = await createFullAssessment();
        const first = await createQuestion(assessment, { question: "First" });
        const second = await createQuestion(assessment, { question: "Second" });
        const mini = await createQuickMini(assessment, [second, first]);

        const response = await request(app).get(
            `/assessment/quick/${mini._id}`,
        );

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Quick mini assessment");
        expect(response.body.data.questions.map((q) => q.question)).toEqual([
            "Second",
            "First",
        ]);
    });

    it("should return a 404 for an unknown mini", async () => {
        const response = await request(app).get(
            `/assessment/quick/${new mongoose.Types.ObjectId()}`,
        );

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Quick mini assessment not found");
    });
});

describe("POST /assessment/attach-price", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        const admin = await createAdmin();
        adminToken = getAdminToken(admin._id);
    });

    const attach = (body, token = adminToken) =>
        request(app)
            .post("/assessment/attach-price")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    it("should return a 400 when the body is incomplete", async () => {
        const response = await attach({});

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "assessmentId and priceCatalogId are required",
        );
    });

    it("should return a 404 for an unknown assessment", async () => {
        const response = await attach({
            assessmentId: String(new mongoose.Types.ObjectId()),
            priceCatalogId: String(new mongoose.Types.ObjectId()),
        });

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Assessment not found");
    });

    it("should return a 401 for a user token", async () => {
        const user = await createUser();

        const response = await attach(
            { assessmentId: "a", priceCatalogId: "b" },
            getAccessToken(user._id),
        );

        expect(response.statusCode).toBe(401);
    });
});
