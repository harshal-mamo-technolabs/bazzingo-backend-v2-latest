const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const assessmentRouter = require("../../src/modules/assessment/assessmentRouter");
const AssessmentScore = require("../../src/modules/assessment/assessmentScoreModel");
const DailyChallenge = require("../../src/modules/game/dailyChallengeModel");
const PriceCatalog = require("../../src/modules/price-catalog/priceCatalogModel");
const Plan = require("../../src/modules/plan/planModel");
const Subscription = require("../../src/modules/stripe/subscriptionModel");
const User = require("../../src/modules/user/userModel");
const { getCETMidnight } = require("../../src/common/utils/time");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const {
    createFullAssessment,
    createQuestion,
    createQuickMini,
    createScore,
    purchaseAssessment,
} = require("../utils/assessmentFixtures");

const app = express();
app.use(express.json());
app.use(requestLogger);
app.use("/assessment", assessmentRouter);
app.use(globalErrorHandler);

const authed = (method, path, token) =>
    request(app)[method](path).set("Authorization", `Bearer ${token}`);

describe("GET /assessment", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const list = () => authed("get", "/assessment", token);

    it("should return the success envelope", async () => {
        const response = await list();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Full assessments (one per category with priority logic)",
        );
    });

    it("should return one assessment per active category", async () => {
        await createFullAssessment({ mainCategory: "iq-test" });
        await createFullAssessment({
            mainCategory: "driving-licence",
            title: "Driving",
        });

        const response = await list();

        expect(response.body.data.categories.sort()).toEqual([
            "driving-licence",
            "iq-test",
        ]);
        expect(response.body.data.total).toBe(2);
    });

    it("should ignore inactive assessments", async () => {
        await createFullAssessment({ active: false });

        const response = await list();

        expect(response.body.data.categories).toEqual([]);
        expect(response.body.data.items).toEqual([]);
    });

    it("should prefer a purchased unsubmitted assessment", async () => {
        await createFullAssessment({ title: "Free" });
        const bought = await createFullAssessment({ title: "Bought" });
        await purchaseAssessment(user, bought);

        const response = await list();

        expect(response.body.data.items[0].title).toBe("Bought");
        expect(response.body.data.items[0].isAssessmentPurchased).toBe(true);
    });

    it("should not offer a purchased assessment already submitted", async () => {
        const bought = await createFullAssessment({ title: "Bought" });
        await purchaseAssessment(user, bought);
        await createScore(user, { assessmentId: bought._id });

        const response = await list();

        expect(response.body.data.items[0].isAssessmentPurchased).toBe(false);
    });

    it("should list purchased unsubmitted assessments separately", async () => {
        const bought = await createFullAssessment({ title: "Bought" });
        await purchaseAssessment(user, bought);

        const response = await list();

        expect(response.body.data.purchasedUnsubmittedAssessments).toHaveLength(
            1,
        );
        expect(
            response.body.data.purchasedUnsubmittedAssessments[0].title,
        ).toBe("Bought");
    });

    it("should drop a purchased assessment from the separate list once submitted", async () => {
        const bought = await createFullAssessment({ title: "Bought" });
        await purchaseAssessment(user, bought);
        await createScore(user, { assessmentId: bought._id });

        const response = await list();

        expect(response.body.data.purchasedUnsubmittedAssessments).toEqual([]);
    });

    it("should carry the adhd and emotional intelligence slots", async () => {
        const response = await list();

        expect(response.body.data.adhdAssessment).toBeNull();
        expect(response.body.data.emotionalIntelligenceAssessment).toBeNull();
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/assessment");

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /assessment/quick", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const getQuick = () => authed("get", "/assessment/quick", token);

    it("should report no assignment today", async () => {
        const response = await getQuick();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "No quick assessment assigned today",
        );
        expect(response.body.data.assessment).toBeNull();
        expect(response.body.data.isCompleted).toBe(false);
    });

    it("should return today's mini with its parent details", async () => {
        const assessment = await createFullAssessment();
        const question = await createQuestion(assessment);
        const mini = await createQuickMini(assessment, [question]);
        await DailyChallenge.create({
            date: getCETMidnight(new Date()),
            games: [],
            quickAssessmentId: mini._id,
        });

        const response = await getQuick();

        expect(response.body.message).toBe("Today's quick assessment");
        expect(response.body.data.assessment.title).toBe("IQ Test");
        expect(response.body.data.assessment.mainCategory).toBe("iq-test");
        expect(response.body.data.questions).toHaveLength(1);
    });

    it("should report completion when the user already scored today", async () => {
        const assessment = await createFullAssessment();
        const question = await createQuestion(assessment);
        const mini = await createQuickMini(assessment, [question]);
        const today = getCETMidnight(new Date());
        await DailyChallenge.create({
            date: today,
            games: [],
            quickAssessmentId: mini._id,
        });
        await AssessmentScore.create({
            userId: user._id,
            type: "quick",
            assessmentId: mini._id,
            mainCategory: "iq-test",
            date: today,
            totalScore: 7,
        });

        const response = await getQuick();

        expect(response.body.data.isCompleted).toBe(true);
        expect(response.body.data.completedScore).toBe(7);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/assessment/quick");

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /assessment/recent-activity", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const recent = () => authed("get", "/assessment/recent-activity", token);

    it("should return an empty list", async () => {
        const response = await recent();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Latest assessment scores retrieved",
        );
        expect(response.body.data.total).toBe(0);
    });

    it("should compute the full assessment denominator", async () => {
        const assessment = await createFullAssessment({
            questions: 4,
            fixedPoint: 5,
        });
        await createScore(user, { assessmentId: assessment._id });

        const response = await recent();

        expect(response.body.data.scores[0].outOfScore).toBe(20);
        expect(response.body.data.scores[0].assessmentName).toBe("IQ Test");
    });

    it("should compute the quick assessment denominator", async () => {
        const assessment = await createFullAssessment();
        const question = await createQuestion(assessment);
        const mini = await createQuickMini(assessment, [question]);
        await AssessmentScore.create({
            userId: user._id,
            type: "quick",
            assessmentId: mini._id,
            mainCategory: "iq-test",
            date: new Date(),
            totalScore: 5,
        });

        const response = await recent();

        expect(response.body.data.scores[0].outOfScore).toBe(5);
        expect(response.body.data.scores[0].assessmentName).toBe(
            "Quick Assessment",
        );
    });

    it("should cap the list at five", async () => {
        for (let i = 0; i < 7; i += 1) {
            const assessment = await createFullAssessment({
                title: `A${i}`,
            });
            await createScore(user, { assessmentId: assessment._id });
        }

        const response = await recent();

        expect(response.body.data.total).toBe(5);
    });
});

describe("GET /assessment/program-score", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const programScore = () =>
        authed("get", "/assessment/program-score", token);

    it("should pad every active category with a zero record", async () => {
        await createFullAssessment({ mainCategory: "iq-test" });

        const response = await programScore();

        expect(response.statusCode).toBe(200);
        expect(response.body.data.availableCategories).toEqual(["iq-test"]);
        expect(response.body.data.programScore["iq-test"]).toEqual({
            programScore: 0,
            scores: [],
        });
    });

    it("should return the stored program score", async () => {
        await createFullAssessment({ mainCategory: "iq-test" });
        await User.findByIdAndUpdate(user._id, {
            $set: { "programScore.iq-test": { programScore: 120, scores: [] } },
        });

        const response = await programScore();

        expect(response.body.data.programScore["iq-test"].programScore).toBe(
            120,
        );
    });
});

describe("GET /assessment/program-scores-only", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    it("should return a flat category to score map", async () => {
        await User.findByIdAndUpdate(user._id, {
            $set: { "programScore.iq-test": { programScore: 118, scores: [] } },
        });

        const response = await authed(
            "get",
            "/assessment/program-scores-only",
            token,
        );

        expect(response.statusCode).toBe(200);
        expect(response.body.data).toEqual({ "iq-test": 118 });
    });

    it("should return an empty object when nothing is stored", async () => {
        const response = await authed(
            "get",
            "/assessment/program-scores-only",
            token,
        );

        expect(response.body.data).toEqual({});
    });
});

describe("GET /assessment/score/:scoreId", () => {
    useInMemoryDatabase();

    it("should return the public score with user and category", async () => {
        const user = await createUser({ name: "Harshal", age: 27 });
        const assessment = await createFullAssessment();
        const score = await createScore(user, {
            assessmentId: assessment._id,
        });

        const response = await request(app).get(
            `/assessment/score/${score._id}`,
        );

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Assessment score");
        expect(response.body.data.score.userName).toBe("Harshal");
        expect(response.body.data.score.userAge).toBe(27);
        expect(response.body.data.score.mainCategory).toBe("iq-test");
        expect(response.body.data.score.byCategory).toEqual({ logic: 10 });
    });

    it("should return a 404 for an unknown score", async () => {
        const response = await request(app).get(
            `/assessment/score/${new mongoose.Types.ObjectId()}`,
        );

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Score not found");
    });
});

describe("GET /assessment/subscription-and-assessments", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const get = () =>
        authed("get", "/assessment/subscription-and-assessments", token);

    it("should default to an inactive subscription", async () => {
        const response = await get();

        expect(response.statusCode).toBe(200);
        expect(response.body.data.subscription).toEqual({
            isActive: false,
            planName: null,
            planId: null,
            isTrial: false,
            planDuration: null,
        });
        expect(response.body.data.assessments).toEqual([]);
    });

    it("should report an active subscription with its plan", async () => {
        const plan = await Plan.create({
            name: "Pro",
            stripeProductId: "prod_pro",
        });
        await Subscription.create({
            userId: user._id,
            status: "active",
            planId: plan._id,
            planDuration: "monthly",
            stripeSubscriptionId: "sub_1",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 86400000),
        });

        const response = await get();

        expect(response.body.data.subscription.isActive).toBe(true);
        expect(response.body.data.subscription.planName).toBe("Pro");
        expect(response.body.data.subscription.planDuration).toBe("Monthly");
    });

    it("should report a trialing subscription as active and trial", async () => {
        await Subscription.create({
            userId: user._id,
            status: "trialing",
            stripeSubscriptionId: "sub_2",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 86400000),
        });

        const response = await get();

        expect(response.body.data.subscription.isActive).toBe(true);
        expect(response.body.data.subscription.isTrial).toBe(true);
    });

    it("should list purchased assessments with their submitted flag", async () => {
        const assessment = await createFullAssessment();
        await purchaseAssessment(user, assessment);

        const response = await get();

        expect(response.body.data.assessments).toHaveLength(1);
        expect(response.body.data.assessments[0].isSubmitted).toBe(false);
    });

    it("should mark a submitted purchase", async () => {
        const assessment = await createFullAssessment();
        await purchaseAssessment(user, assessment);
        await createScore(user, { assessmentId: assessment._id });

        const response = await get();

        expect(response.body.data.assessments[0].isSubmitted).toBe(true);
    });
});

describe("GET /assessment/statistics", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const stats = () => authed("get", "/assessment/statistics", token);

    it("should return an empty statistics object with no assessments", async () => {
        const response = await stats();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Assessment statistics retrieved successfully",
        );
        expect(response.body.data.statistics).toEqual({});
    });

    it("should seed every subcategory at zero when there is no data", async () => {
        await createFullAssessment();

        const response = await stats();

        expect(response.body.data.statistics["iq-test"].isDataPresent).toBe(
            false,
        );
        expect(response.body.data.statistics["iq-test"].today).toEqual({
            logic: 0,
            memory: 0,
        });
    });

    it("should total the subcategory points for the period", async () => {
        const assessment = await createFullAssessment();
        await createScore(user, {
            assessmentId: assessment._id,
            byCategory: { logic: 6, memory: 4 },
        });

        const response = await stats();

        expect(response.body.data.statistics["iq-test"].isDataPresent).toBe(
            true,
        );
        expect(response.body.data.statistics["iq-test"].today).toEqual({
            logic: 6,
            memory: 4,
        });
    });

    it("should ignore a subcategory that is not on the assessment", async () => {
        const assessment = await createFullAssessment();
        await createScore(user, {
            assessmentId: assessment._id,
            byCategory: { logic: 6, speed: 99 },
        });

        const response = await stats();

        expect(
            response.body.data.statistics["iq-test"].today.speed,
        ).toBeUndefined();
    });
});

describe("GET /assessment/daily-assessment-purchase-recommendation", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const recommend = () =>
        authed(
            "get",
            "/assessment/daily-assessment-purchase-recommendation",
            token,
        );

    it("should return a 404 when nothing is available", async () => {
        const response = await recommend();

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("No assessments available");
    });

    it("should recommend an unpurchased assessment with a zero price", async () => {
        await createFullAssessment();

        const response = await recommend();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Daily recommended assessment retrieved successfully",
        );
        expect(response.body.data.price).toEqual({
            currency: "EUR",
            unitAmount: 0,
        });
    });

    it("should resolve the price by stripe product id", async () => {
        const assessment = await createFullAssessment();
        await PriceCatalog.create({
            stripeProductId: assessment.stripeProductId,
            stripePriceId: "price_1",
            type: "one_time",
            unitAmount: 499,
            currency: "eur",
            active: true,
            default: true,
        });

        const response = await recommend();

        expect(response.body.data.price.unitAmount).toBe(499);
    });

    it("should prefer today's challenge assessment when not purchased", async () => {
        const target = await createFullAssessment({ title: "Target" });
        const question = await createQuestion(target);
        const mini = await createQuickMini(target, [question]);
        await DailyChallenge.create({
            date: getCETMidnight(new Date()),
            games: [],
            quickAssessmentId: mini._id,
        });
        await createFullAssessment({ title: "Other" });

        const response = await recommend();

        expect(response.body.data.title).toBe("Target");
    });

    it("should skip today's challenge assessment when already purchased", async () => {
        const target = await createFullAssessment({ title: "Target" });
        const question = await createQuestion(target);
        const mini = await createQuickMini(target, [question]);
        await DailyChallenge.create({
            date: getCETMidnight(new Date()),
            games: [],
            quickAssessmentId: mini._id,
        });
        await purchaseAssessment(user, target);
        await createFullAssessment({ title: "Other" });

        const response = await recommend();

        expect(response.body.data.title).toBe("Other");
    });
});

describe("GET /assessment/current-mini-assessment-purchase-status", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const status = () =>
        authed(
            "get",
            "/assessment/current-mini-assessment-purchase-status",
            token,
        );

    it("should report no assignment today", async () => {
        const response = await status();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "No quick assessment assigned today",
        );
        expect(response.body.data.assessment).toBeNull();
        expect(response.body.data.isAlreadyPurchased).toBe(false);
    });

    it("should report the assessment and purchase status", async () => {
        const assessment = await createFullAssessment();
        const question = await createQuestion(assessment);
        const mini = await createQuickMini(assessment, [question]);
        await DailyChallenge.create({
            date: getCETMidnight(new Date()),
            games: [],
            quickAssessmentId: mini._id,
        });

        const response = await status();

        expect(response.body.data.title).toBe("IQ Test");
        expect(response.body.data.isAlreadyPurchased).toBe(false);
    });

    it("should report a purchased assessment", async () => {
        const assessment = await createFullAssessment();
        const question = await createQuestion(assessment);
        const mini = await createQuickMini(assessment, [question]);
        await DailyChallenge.create({
            date: getCETMidnight(new Date()),
            games: [],
            quickAssessmentId: mini._id,
        });
        await purchaseAssessment(user, assessment);

        const response = await status();

        expect(response.body.data.isAlreadyPurchased).toBe(true);
    });
});

describe("GET /assessment/user/submitted-full-assessments", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const submitted = () =>
        authed("get", "/assessment/user/submitted-full-assessments", token);

    it("should report none", async () => {
        const response = await submitted();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "No submitted full assessments found",
        );
        expect(response.body.data.assessments).toEqual([]);
    });

    it("should return one row per assessment", async () => {
        const assessment = await createFullAssessment();
        await createScore(user, { assessmentId: assessment._id });

        const response = await submitted();

        expect(response.body.data.assessments).toHaveLength(1);
        expect(response.body.data.assessments[0].title).toBe("IQ Test");
    });

    it("should not repeat an assessment scored twice", async () => {
        const assessment = await createFullAssessment();
        await createScore(user, { assessmentId: assessment._id });

        const response = await submitted();

        expect(response.body.data.assessments).toHaveLength(1);
    });
});

describe("GET /assessment/user/full-scores", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser({ name: "Harshal", age: 27 });
        token = getAccessToken(user._id);
    });

    const fullScores = () =>
        authed("get", "/assessment/user/full-scores", token);

    it("should report none", async () => {
        const response = await fullScores();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("No full assessment scores found");
        expect(response.body.data.scores).toEqual([]);
    });

    it("should format a full score", async () => {
        const assessment = await createFullAssessment();
        await createScore(user, { assessmentId: assessment._id });

        const response = await fullScores();

        const score = response.body.data.scores[0];
        expect(score.assessmentName).toBe("IQ Test");
        expect(score.userName).toBe("Harshal");
        expect(score.userAge).toBe(27);
        expect(score.totalQuestions).toBe(4);
        expect(score.isSpecial).toBe(false);
        expect(score.byCategory).toEqual({ logic: 10 });
    });

    it("should put the landing page score first and flag it special", async () => {
        const assessment = await createFullAssessment();
        const question = await createQuestion(assessment);
        const mini = await createQuickMini(assessment, [question]);
        await User.findByIdAndUpdate(user._id, {
            landingPageName: "lp",
            quickMiniAssessmntId: mini._id,
        });
        await AssessmentScore.create({
            userId: user._id,
            type: "quick",
            assessmentId: mini._id,
            mainCategory: "iq-test",
            date: new Date(),
            totalScore: 3,
        });
        await createScore(user, { assessmentId: assessment._id });

        const response = await fullScores();

        expect(response.body.data.scores[0].isSpecial).toBe(true);
        expect(response.body.data.scores[0].type).toBe("quick");
        expect(response.body.data.scores[0].totalQuestions).toBe(1);
    });
});
