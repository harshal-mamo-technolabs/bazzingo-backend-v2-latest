const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const assessmentRouter = require("../../src/modules/assessment/assessmentRouter");
const AssessmentScore = require("../../src/modules/assessment/assessmentScoreModel");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const UserDailyActivity = require("../../src/modules/streak/userDailyActivityModel");
const User = require("../../src/modules/user/userModel");
const DailyChallenge = require("../../src/modules/game/dailyChallengeModel");
const { getCETMidnight } = require("../../src/common/utils/time");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const {
    createFullAssessment,
    createQuestion,
    createQuickMini,
} = require("../utils/assessmentFixtures");

const app = express();
app.use(express.json());
app.use(requestLogger);
app.use("/assessment", assessmentRouter);
app.use(globalErrorHandler);

describe("POST /assessment/submit", () => {
    useInMemoryDatabase();

    let user;
    let token;
    let assessment;
    let questions;

    beforeEach(async () => {
        user = await createUser({ age: 27 });
        token = getAccessToken(user._id);
        assessment = await createFullAssessment();
        questions = [
            await createQuestion(assessment, { question: "Q1" }),
            await createQuestion(assessment, {
                question: "Q2",
                subcategory: "memory",
            }),
        ];
    });

    const submit = (body, accessToken = token) =>
        request(app)
            .post("/assessment/submit")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    const allCorrect = () =>
        questions.map((question) => ({
            questionId: String(question._id),
            chosenIndex: question.answerIndex,
        }));

    describe("full assessment", () => {
        const body = (answers) => ({
            type: "full",
            assessmentId: undefined,
            answers,
        });

        it("should return a 201 and the success envelope", async () => {
            const response = await submit({
                ...body(allCorrect()),
                assessmentId: String(assessment._id),
            });

            expect(response.statusCode).toBe(201);
            expect(response.body.message).toBe(
                "Full assessment score submitted",
            );
        });

        it("should score every correct answer", async () => {
            const response = await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            expect(response.body.data.score.totalScore).toBe(10);
            expect(response.body.data.outOfScore).toBe(10);
        });

        it("should score a wrong answer as zero", async () => {
            const response = await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: [
                    {
                        questionId: String(questions[0]._id),
                        chosenIndex: 0,
                    },
                ],
            });

            expect(response.body.data.score.totalScore).toBe(0);
        });

        it("should ignore an answer for an unknown question", async () => {
            const response = await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: [
                    {
                        questionId: String(new mongoose.Types.ObjectId()),
                        chosenIndex: 0,
                    },
                ],
            });

            expect(response.body.data.score.totalScore).toBe(0);
        });

        it("should break the score down by subcategory", async () => {
            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            const score = await AssessmentScore.findOne({ userId: user._id });
            expect(Object.fromEntries(score.byCategory)).toEqual({
                logic: 5,
                memory: 5,
            });
        });

        it("should store the main category", async () => {
            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            const score = await AssessmentScore.findOne({ userId: user._id });
            expect(score.mainCategory).toBe("iq-test");
        });

        it("should add the score to the leaderboard", async () => {
            await Leaderboard.create({
                userId: user._id,
                assessment: { totalScore: 0, category: {} },
            });

            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            const row = await Leaderboard.findOne({ userId: user._id });
            expect(row.assessment.totalScore).toBe(10);
            expect(row.assessment.category.get("iq-test")).toBe(10);
        });

        it("should compute and store a program score", async () => {
            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            const score = await AssessmentScore.findOne({ userId: user._id });
            expect(score.programScore).toBe(74);
        });

        it("should mirror an iq-test score onto the legacy user fields", async () => {
            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            const updated = await User.findById(user._id);
            expect(updated.iq).toBe(74);
            expect(updated.iqScores).toHaveLength(1);
            expect(updated.iqScores[0].assessmentScore).toBe(10);
            expect(updated.iqScores[0].ageGroup).toBe("26-34");
        });

        it("should mirror a driving-licence score onto its legacy fields", async () => {
            const driving = await createFullAssessment({
                mainCategory: "driving-licence",
                title: "Driving",
            });
            const question = await createQuestion(driving);

            await submit({
                type: "full",
                assessmentId: String(driving._id),
                answers: [
                    {
                        questionId: String(question._id),
                        chosenIndex: question.answerIndex,
                    },
                ],
            });

            const updated = await User.findById(user._id);
            expect(updated.drivingLicense).toBe(72);
            expect(updated.drivingLicenseScores).toHaveLength(1);
        });

        it("should record the program score on the user", async () => {
            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            const updated = await User.findById(user._id);
            expect(updated.programScore.get("iq-test").programScore).toBe(74);
            expect(updated.programScore.get("iq-test").scores).toHaveLength(1);
        });

        it("should append to the program score history on resubmission", async () => {
            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            const updated = await User.findById(user._id);
            expect(updated.programScore.get("iq-test").scores).toHaveLength(2);
        });

        it("should keep one score row per assessment", async () => {
            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: [],
            });

            const scores = await AssessmentScore.find({ userId: user._id });
            expect(scores).toHaveLength(1);
            expect(scores[0].totalScore).toBe(0);
        });

        it("should return the unlocked badges array", async () => {
            const response = await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: allCorrect(),
            });

            expect(Array.isArray(response.body.data.unlockedBadges)).toBe(true);
        });

        it("should return a 404 when the assessment has no questions", async () => {
            const empty = await createFullAssessment({ title: "Empty" });

            const response = await submit({
                type: "full",
                assessmentId: String(empty._id),
                answers: [],
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe(
                "Full assessment questions not found",
            );
        });
    });

    describe("quick assessment", () => {
        let mini;

        beforeEach(async () => {
            mini = await createQuickMini(assessment, questions);
        });

        const submitQuick = () =>
            submit({
                type: "quick",
                assessmentId: String(mini._id),
                answers: allCorrect(),
            });

        const assignToday = async () => {
            await DailyChallenge.create({
                date: getCETMidnight(new Date()),
                games: [],
                quickAssessmentId: mini._id,
            });
        };

        it("should report a submission outside today's assignment", async () => {
            const response = await submitQuick();

            expect(response.statusCode).toBe(201);
            expect(response.body.message).toBe(
                "Quick assessment score submitted (not today's assignment)",
            );
            expect(response.body.data.isTodayAssigned).toBe(false);
        });

        it("should report today's assignment", async () => {
            await assignToday();

            const response = await submitQuick();

            expect(response.body.message).toBe(
                "Quick assessment score submitted (today's assignment)",
            );
            expect(response.body.data.isTodayAssigned).toBe(true);
        });

        it("should resolve the main category from the parent assessment", async () => {
            await submitQuick();

            const score = await AssessmentScore.findOne({ userId: user._id });
            expect(score.mainCategory).toBe("iq-test");
        });

        it("should mark the day complete only for today's assignment", async () => {
            await submitQuick();

            expect(await UserDailyActivity.countDocuments()).toBe(0);
        });

        it("should mark the day complete for today's assignment", async () => {
            await assignToday();

            await submitQuick();

            const activity = await UserDailyActivity.findOne({
                userId: user._id,
            });
            expect(activity.isAssessmentCompleted).toBe(true);
        });

        it("should never compute a program score for a quick submission", async () => {
            await assignToday();

            await submitQuick();

            const updated = await User.findById(user._id);
            expect(updated.iqScores).toHaveLength(0);
        });

        it("should return a 404 for an unknown mini", async () => {
            const response = await submit({
                type: "quick",
                assessmentId: String(new mongoose.Types.ObjectId()),
                answers: [],
            });

            expect(response.statusCode).toBe(404);
            expect(response.body.message).toBe(
                "Quick mini assessment not found",
            );
        });
    });

    describe("validation", () => {
        it("should return a 400 for an unknown type", async () => {
            const response = await submit({
                type: "partial",
                assessmentId: String(assessment._id),
                answers: [],
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Invalid type");
        });

        it("should return a 400 when assessmentId is missing", async () => {
            const response = await submit({ type: "full", answers: [] });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "assessmentId and answers[] are required",
            );
        });

        it("should return a 400 when answers is not an array", async () => {
            const response = await submit({
                type: "full",
                assessmentId: String(assessment._id),
                answers: "nope",
            });

            expect(response.statusCode).toBe(400);
        });

        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post("/assessment/submit")
                .send({});

            expect(response.statusCode).toBe(401);
        });
    });
});
