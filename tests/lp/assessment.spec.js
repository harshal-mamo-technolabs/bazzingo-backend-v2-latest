const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { config } = require("../../src/config");
const logger = require("../../src/config/logger");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const { asyncWrapper } = require("../../src/common/utils/wrapper");
const {
    AssessmentService,
} = require("../../src/modules/assessment/assessmentService");
const { BadgeService } = require("../../src/modules/badge/badgeService");
const {
    LeaderboardService,
} = require("../../src/modules/leaderboard/leaderboardService");
const { LpController } = require("../../src/modules/lp/lpController");
const { LpService } = require("../../src/modules/lp/lpService");
const {
    KlaviyoSyncService,
} = require("../../src/modules/lp/klaviyoSyncService");
const AssessmentScore = require("../../src/modules/assessment/assessmentScoreModel");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const User = require("../../src/modules/user/userModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");
const {
    createFullAssessment,
    createQuestion,
    createQuickMini,
} = require("../utils/assessmentFixtures");

const klaviyoService = {
    upsertProfileByEmail: jest.fn(async () => ({ ok: true })),
    createEvent: jest.fn(async () => ({ ok: true })),
    getProfileByEmail: jest.fn(async () => ({ skipped: false, profile: null })),
};

const helpscoutService = { scheduleSyncContactUtmToHelpScout: jest.fn() };

const buildApp = () => {
    const assessmentService = new AssessmentService(logger);
    const leaderboardService = new LeaderboardService(logger);
    const controller = new LpController(
        new LpService(logger),
        assessmentService,
        new KlaviyoSyncService(
            logger,
            klaviyoService,
            assessmentService,
            leaderboardService,
        ),
        klaviyoService,
        leaderboardService,
        new BadgeService(logger),
        helpscoutService,
        logger,
    );

    const handler = (method) =>
        asyncWrapper(controller[method].bind(controller));

    const app = express();
    app.use(express.json());
    app.use(requestLogger);
    app.get(
        "/lp/assessment/:assessmentId/quick",
        handler("getQuickAssessmentById"),
    );
    app.post(
        "/lp/assessment/submit-score",
        handler("submitQuickAssessmentScoreLp"),
    );
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const signToken = (userId, expiresIn = "1h") =>
    jwt.sign({ userId: String(userId) }, config.JWT_SECRET, { expiresIn });

const seedQuickAssessment = async ({
    fullOverrides = {},
    miniOverrides = {},
} = {}) => {
    const full = await createFullAssessment(fullOverrides);
    const first = await createQuestion(full, {
        question: "First question",
        answerIndex: 3,
        points: 5,
    });
    const second = await createQuestion(full, {
        subcategory: "memory",
        question: "Second question",
        answerIndex: 0,
        points: 5,
    });
    const mini = await createQuickMini(full, [first, second], miniOverrides);

    return { full, first, second, mini };
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe("GET /lp/assessment/:assessmentId/quick", () => {
    useInMemoryDatabase();

    const getQuick = (assessmentId) =>
        request(app).get(`/lp/assessment/${assessmentId}/quick`);

    it("should return the quick assessment with its full assessment details", async () => {
        const { full, mini } = await seedQuickAssessment();

        const response = await getQuick(mini._id);

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe(
            "Quick assessment retrieved successfully",
        );
        expect(response.body.data.assessment).toMatchObject({
            _id: String(mini._id),
            fullAssessment: String(full._id),
            size: 2,
            order: 1,
            isActive: true,
            title: "IQ Test",
            description: "Full IQ test",
            mainCategory: "iq-test",
        });
    });

    it("should return the questions in the order stored on the mini assessment", async () => {
        const { first, second, mini } = await seedQuickAssessment();

        const response = await getQuick(mini._id);

        expect(response.body.data.questions.map((q) => q._id)).toEqual([
            String(first._id),
            String(second._id),
        ]);
        expect(response.body.data.questions[0]).toMatchObject({
            subcategory: "logic",
            questionType: "text",
            question: "First question",
            optionsType: "text",
            answerIndex: 3,
            points: 5,
        });
    });

    it("should skip question ids that no longer exist", async () => {
        const { first, second, mini } = await seedQuickAssessment();
        await mongoose.model("QuestionAndAnswer").deleteOne({ _id: first._id });

        const response = await getQuick(mini._id);

        expect(response.body.data.questions.map((q) => q._id)).toEqual([
            String(second._id),
        ]);
    });

    it("should return a 404 when the quick assessment does not exist", async () => {
        const response = await getQuick(new mongoose.Types.ObjectId());

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Quick assessment not found");
    });

    it("should return a 404 when the quick assessment is not active", async () => {
        const { mini } = await seedQuickAssessment({
            miniOverrides: { isActive: false },
        });

        const response = await getQuick(mini._id);

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Quick assessment is not active");
    });

    it("should return a 404 when the full assessment is missing", async () => {
        const { full, mini } = await seedQuickAssessment();
        await mongoose.model("FullAssessment").deleteOne({ _id: full._id });

        const response = await getQuick(mini._id);

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Full assessment not found");
    });

    it("should return a 404 when the full assessment is not active", async () => {
        const { mini } = await seedQuickAssessment({
            fullOverrides: { active: false },
        });

        const response = await getQuick(mini._id);

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Full assessment is not active");
    });
});

describe("POST /lp/assessment/submit-score", () => {
    useInMemoryDatabase();

    const submit = (body) =>
        request(app).post("/lp/assessment/submit-score").send(body);

    const correctAnswers = (first, second) => [
        { questionId: String(first._id), chosenIndex: 3 },
        { questionId: String(second._id), chosenIndex: 0 },
    ];

    it("should return a 400 when the token is missing", async () => {
        const response = await submit({ assessmentId: "x", answers: [] });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Token is required");
    });

    it("should return a 400 when the assessment id is missing", async () => {
        const user = await createUser();

        const response = await submit({
            token: signToken(user._id),
            answers: [],
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "assessmentId and answers array are required",
        );
    });

    it("should return a 400 when the answers are not an array", async () => {
        const user = await createUser();

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(new mongoose.Types.ObjectId()),
            answers: "nope",
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "assessmentId and answers array are required",
        );
    });

    it("should return a 401 when the token is invalid", async () => {
        const response = await submit({
            token: "not-a-token",
            assessmentId: String(new mongoose.Types.ObjectId()),
            answers: [],
        });

        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe("Invalid or expired token");
    });

    it("should return a 401 when the token is expired", async () => {
        const user = await createUser();
        const token = jwt.sign(
            { userId: String(user._id) },
            config.JWT_SECRET,
            { expiresIn: "-1s" },
        );

        const response = await submit({
            token,
            assessmentId: String(new mongoose.Types.ObjectId()),
            answers: [],
        });

        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe("Invalid or expired token");
    });

    it("should return a 404 when the user no longer exists", async () => {
        const response = await submit({
            token: signToken(new mongoose.Types.ObjectId()),
            assessmentId: String(new mongoose.Types.ObjectId()),
            answers: [],
        });

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("User not found");
    });

    it("should return a 403 when the account is deleted", async () => {
        const user = await createUser({ isDeleted: true });

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(new mongoose.Types.ObjectId()),
            answers: [],
        });

        expect(response.statusCode).toBe(403);
        expect(response.body.message).toBe(
            "This account has been deleted. Please contact support if you want it restored.",
        );
        expect(response.body.context).toEqual({ reason: "account_deleted" });
    });

    it("should return a 404 when the quick mini assessment is missing", async () => {
        const user = await createUser();

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(new mongoose.Types.ObjectId()),
            answers: [],
        });

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Quick mini assessment not found");
    });

    it("should return a 400 when the quick assessment is not active", async () => {
        const user = await createUser();
        const { mini } = await seedQuickAssessment({
            miniOverrides: { isActive: false },
        });

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: [],
        });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("Quick assessment is not active");
    });

    it("should return a 404 when no questions exist for the assessment", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();
        await mongoose
            .model("QuestionAndAnswer")
            .deleteMany({ _id: { $in: [first._id, second._id] } });

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: [],
        });

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe(
            "Questions not found for this assessment",
        );
    });

    it("should return a 201 with the score, out of score and percentage", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        });

        expect(response.statusCode).toBe(201);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe(
            "Quick assessment score submitted successfully",
        );
        expect(response.body.data.outOfScore).toBe(10);
        expect(response.body.data.percentage).toBe(100);
        expect(response.body.data.score).toMatchObject({
            userId: String(user._id),
            type: "quick",
            assessmentId: String(mini._id),
            mainCategory: "iq-test",
            totalScore: 10,
        });
    });

    it("should score only the correct answers", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: [
                { questionId: String(first._id), chosenIndex: 3 },
                { questionId: String(second._id), chosenIndex: 2 },
                {
                    questionId: String(new mongoose.Types.ObjectId()),
                    chosenIndex: 0,
                },
            ],
        });

        expect(response.body.data.score.totalScore).toBe(5);
        expect(response.body.data.score.byCategory).toEqual({
            logic: 5,
            memory: 0,
        });
        expect(response.body.data.percentage).toBe(50);
    });

    it("should calculate the landing page program score with its own divisor", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        });

        expect(response.body.data.score.programScore).toBe(82);
    });

    it("should store the program score on the user", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();

        await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        });

        const updated = await User.findById(user._id);
        expect(updated.programScore.get("iq-test").programScore).toBe(82);
        expect(updated.programScore.get("iq-test").scores).toHaveLength(1);
        expect(updated.programScore.get("iq-test").scores[0]).toMatchObject({
            programScore: 82,
            assessmentScore: 10,
        });
    });

    it("should push the legacy iq fields for an iq test", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();

        await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        });

        const updated = await User.findById(user._id);
        expect(updated.iq).toBe(82);
        expect(updated.iqScores).toHaveLength(1);
        expect(updated.iqScores[0]).toMatchObject({
            iqScore: 82,
            assessmentScore: 10,
            ageGroup: "26-34",
        });
    });

    it("should push the legacy driving licence fields for a driving licence test", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment({
            fullOverrides: {
                mainCategory: "driving-licence",
                stripeProductId: "prod_dl",
            },
        });

        await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        });

        const updated = await User.findById(user._id);
        expect(updated.drivingLicense).toBe(82);
        expect(updated.drivingLicenseScores).toHaveLength(1);
    });

    it("should sync the leaderboard profile and add the assessment score", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();

        await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        });

        const row = await Leaderboard.findOne({ userId: user._id });
        expect(row.name).toBe("Harshal");
        expect(row.ageGroup).toBe("25-34");
        expect(row.assessment.totalScore).toBe(10);
        expect(row.assessment.category.get("iq-test")).toBe(10);
    });

    it("should mark the user as having submitted an assessment", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();

        await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        });

        const updated = await User.findById(user._id);
        expect(updated.isAssessmentSubmited).toBe(true);
    });

    it("should upsert the same score document on a resubmission", async () => {
        const user = await createUser();
        const { first, second, mini } = await seedQuickAssessment();
        const body = {
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        };

        await submit(body);
        await submit(body);

        const scores = await AssessmentScore.find({ userId: user._id }).lean();
        expect(scores).toHaveLength(1);
    });

    it("should still submit when a mainCategory cannot be resolved", async () => {
        const user = await createUser();
        const { full, first, second, mini } = await seedQuickAssessment();
        await mongoose.model("FullAssessment").deleteOne({ _id: full._id });

        const response = await submit({
            token: signToken(user._id),
            assessmentId: String(mini._id),
            answers: correctAnswers(first, second),
        });

        expect(response.statusCode).toBe(201);
        expect(response.body.data.score.mainCategory).toBe("assessment");
    });
});
