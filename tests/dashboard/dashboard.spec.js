const request = require("supertest");
const express = require("express");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const dashboardRouter = require("../../src/modules/dashboard/dashboardRouter");
const { getCETMidnight } = require("../../src/common/utils/time");
const GameScore = require("../../src/modules/game/gameScoreModel");
const DailyChallenge = require("../../src/modules/game/dailyChallengeModel");
const AssessmentScore = require("../../src/modules/assessment/assessmentScoreModel");
const UserDailyActivity = require("../../src/modules/streak/userDailyActivityModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const { createGame, createQuickAssessment } = require("../utils/gameFixtures");
const {
    createFullAssessment,
    createQuestion,
    createQuickMini,
} = require("../utils/assessmentFixtures");

const buildApp = () => {
    const app = express();

    app.use(express.json());
    app.use(requestLogger);
    app.use("/dashboard", dashboardRouter);
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const daysAgo = (days) => {
    const date = new Date();

    date.setDate(date.getDate() - days);
    date.setHours(12, 0, 0, 0);

    return date;
};

const addScore = async (user, game, overrides = {}) =>
    await GameScore.create({
        userId: user._id,
        gameId: game._id,
        score: 100,
        suggestedDate: getCETMidnight(new Date()),
        ...overrides,
    });

describe("GET /dashboard", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser({
            programScore: { "iq-test": { programScore: 118, scores: [] } },
        });
        token = getAccessToken(user._id);
    });

    const getStats = (accessToken = token) =>
        request(app)
            .get("/dashboard")
            .set("Authorization", `Bearer ${accessToken}`);

    describe("given the user has games, scores and activity", () => {
        beforeEach(async () => {
            const [logic, memory] = await Promise.all([
                createGame(),
                createGame({ name: "Memory Match", category: "Memory" }),
            ]);

            await addScore(user, logic);
            await addScore(user, memory);
            await addScore(user, logic, {
                suggestedDate: daysAgo(1),
            });

            await UserDailyActivity.create([
                {
                    userId: user._id,
                    date: daysAgo(5),
                    isGamePlayed: true,
                    createdAt: daysAgo(5),
                },
                {
                    userId: user._id,
                    date: daysAgo(4),
                    isGamePlayed: true,
                    createdAt: daysAgo(4),
                },
                {
                    userId: user._id,
                    date: daysAgo(3),
                    isAssessmentCompleted: true,
                    createdAt: daysAgo(3),
                },
            ]);
        });

        it("should return a 200 status code", async () => {
            const response = await getStats();

            expect(response.statusCode).toBe(200);
        });

        it("should return the v1 success envelope", async () => {
            const response = await getStats();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Dashboard stats");
        });

        it("should count the distinct games scored", async () => {
            const response = await getStats();

            expect(response.body.data.uniqueGamesPlayed).toBe(2);
        });

        it("should expose the iq-test program score as iq", async () => {
            const response = await getStats();

            expect(response.body.data.iq).toBe(118);
        });

        it("should return the active days of the window", async () => {
            const response = await getStats();

            expect(response.body.data.streak.days).toHaveLength(3);
        });

        it("should return the longest streak of the window", async () => {
            const response = await getStats();

            expect(response.body.data.streak.stats.longestStreak).toBe(3);
        });

        it("should return a zero current streak when today is idle", async () => {
            const response = await getStats();

            expect(response.body.data.streak.stats.currentStreak).toBe(0);
        });

        it("should return the streak range", async () => {
            const response = await getStats();

            expect(typeof response.body.data.streak.range.start).toBe("string");
            expect(typeof response.body.data.streak.range.end).toBe("string");
        });
    });

    describe("given the funnel category is driving-license", () => {
        it("should expose the score as drivingLicense", async () => {
            const drivingUser = await createUser({
                email: "driver@bazzingo.com",
                userFunnelAssessmentCategory: "driving-license",
                programScore: {
                    "driving-license": { programScore: 75, scores: [] },
                },
            });

            const response = await getStats(getAccessToken(drivingUser._id));

            expect(response.body.data.drivingLicense).toBe(75);
        });
    });

    describe("given the funnel category is neither iq-test nor driving-license", () => {
        it("should expose the score under the raw category key", async () => {
            const otherUser = await createUser({
                email: "other@bazzingo.com",
                userFunnelAssessmentCategory: "adhd",
                programScore: { adhd: { programScore: 42, scores: [] } },
            });

            const response = await getStats(getAccessToken(otherUser._id));

            expect(response.body.data.adhd).toBe(42);
        });
    });

    describe("given the user has no data", () => {
        it("should return a 200 status code", async () => {
            const response = await getStats();

            expect(response.statusCode).toBe(200);
        });

        it("should return zeroed stats", async () => {
            const response = await getStats();

            expect(response.body.data.uniqueGamesPlayed).toBe(0);
            expect(response.body.data.streak.days).toEqual([]);
            expect(response.body.data.streak.stats).toEqual({
                currentStreak: 0,
                longestStreak: 0,
            });
        });
    });

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app).get("/dashboard");

            expect(response.statusCode).toBe(401);
            expect(response.body.message).toBe("Authentication required");
        });
    });
});

describe("GET /dashboard/recent-activity", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const getRecentActivity = (accessToken = token) =>
        request(app)
            .get("/dashboard/recent-activity")
            .set("Authorization", `Bearer ${accessToken}`);

    describe("given two game scores and a full assessment score", () => {
        let fullAssessment;

        beforeEach(async () => {
            const [logic, memory] = await Promise.all([
                createGame(),
                createGame({ name: "Memory Match", category: "Memory" }),
            ]);

            await addScore(user, logic, { score: 100 });
            await addScore(user, memory, { score: 50 });

            fullAssessment = await createFullAssessment();

            await AssessmentScore.create({
                userId: user._id,
                type: "full",
                assessmentId: fullAssessment._id,
                mainCategory: "iq-test",
                date: getCETMidnight(new Date()),
                totalScore: 10,
            });
        });

        it("should return a 200 status code", async () => {
            const response = await getRecentActivity();

            expect(response.statusCode).toBe(200);
        });

        it("should return the v1 success envelope", async () => {
            const response = await getRecentActivity();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe(
                "Recent activity retrieved successfully",
            );
        });

        it("should return three activities", async () => {
            const response = await getRecentActivity();

            expect(response.body.data.activities).toHaveLength(3);
            expect(response.body.data.total).toBe(3);
        });

        it("should return the game percentage out of 200", async () => {
            const response = await getRecentActivity();

            const games = response.body.data.activities.filter(
                (activity) => activity.type === "game",
            );

            expect(games.map((game) => game.percentage).sort()).toEqual([
                25, 50,
            ]);
        });

        it("should return the assessment entry with its max score", async () => {
            const response = await getRecentActivity();

            const assessment = response.body.data.activities.find(
                (activity) => activity.type === "assessment",
            );

            expect(assessment).toEqual({
                type: "assessment",
                name: "IQ Test",
                score: 10,
                outOfScore: 20,
                percentage: 50,
            });
        });
    });

    describe("given the latest assessment score is a quick one", () => {
        it("should score it out of five points per question", async () => {
            const fullAssessment = await createFullAssessment();
            const questions = await Promise.all([
                createQuestion(fullAssessment),
                createQuestion(fullAssessment),
            ]);
            const quickMini = await createQuickMini(fullAssessment, questions);

            await AssessmentScore.create({
                userId: user._id,
                type: "quick",
                assessmentId: quickMini._id,
                mainCategory: "iq-test",
                date: getCETMidnight(new Date()),
                totalScore: 5,
            });

            const response = await getRecentActivity();

            expect(response.body.data.activities[0]).toEqual({
                type: "assessment",
                name: "Quick Assessment",
                score: 5,
                outOfScore: 10,
                percentage: 50,
            });
        });
    });

    describe("given the user has no activity", () => {
        it("should return an empty list", async () => {
            const response = await getRecentActivity();

            expect(response.statusCode).toBe(200);
            expect(response.body.data).toEqual({ activities: [], total: 0 });
        });
    });

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app).get(
                "/dashboard/recent-activity",
            );

            expect(response.statusCode).toBe(401);
            expect(response.body.message).toBe("Authentication required");
        });
    });
});

describe("GET /dashboard/daily-streak-status", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const getDailyStreakStatus = (accessToken = token) =>
        request(app)
            .get("/dashboard/daily-streak-status")
            .set("Authorization", `Bearer ${accessToken}`);

    describe("given a challenge with one submitted game and the quick assessment", () => {
        let challenge;

        beforeEach(async () => {
            const games = await Promise.all([
                createGame(),
                createGame({ name: "Memory Match", category: "Memory" }),
                createGame({ name: "Reflex Rush", category: "Reflex" }),
            ]);
            const quickMini = await createQuickAssessment();
            const date = getCETMidnight(new Date());

            challenge = await DailyChallenge.create({
                date,
                games: games.map((game) => ({
                    gameId: game._id,
                    difficulty: "easy",
                })),
                quickAssessmentId: quickMini._id,
            });

            await addScore(user, games[0], { suggestedDate: date });

            await AssessmentScore.create({
                userId: user._id,
                type: "quick",
                assessmentId: quickMini._id,
                mainCategory: "iq-test",
                date,
                totalScore: 5,
            });
        });

        it("should return a 200 status code", async () => {
            const response = await getDailyStreakStatus();

            expect(response.statusCode).toBe(200);
        });

        it("should return the v1 success envelope", async () => {
            const response = await getDailyStreakStatus();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe(
                "Daily streak status retrieved successfully",
            );
        });

        it("should count the suggested and submitted games", async () => {
            const response = await getDailyStreakStatus();

            expect(response.body.data.dailySuggestedGame).toEqual({
                totalSuggestedGames: 3,
                totalSubmitedGames: 1,
            });
        });

        it("should return the assessment breakdown", async () => {
            const response = await getDailyStreakStatus();

            expect(response.body.data.dailySuggestedAssessment).toEqual({
                totalSuggestedAssessments: 1,
                totalSubmitedAssessments: 1,
                breakdown: {
                    quickAssessment: {
                        suggested: 1,
                        submitted: 1,
                        assessmentId: String(challenge.quickAssessmentId),
                    },
                    fullAssessments: {
                        suggested: 0,
                        submitted: 0,
                        assessmentIds: [],
                    },
                },
            });
        });
    });

    describe("given no daily challenge exists", () => {
        it("should return nulls", async () => {
            const response = await getDailyStreakStatus();

            expect(response.statusCode).toBe(200);
            expect(response.body.data).toEqual({
                dailySuggestedGame: null,
                dailySuggestedAssessment: null,
            });
        });
    });

    describe("given no access token", () => {
        it("should return a 401 status code", async () => {
            const response = await request(app).get(
                "/dashboard/daily-streak-status",
            );

            expect(response.statusCode).toBe(401);
            expect(response.body.message).toBe("Authentication required");
        });
    });
});
