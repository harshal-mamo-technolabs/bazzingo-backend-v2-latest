const request = require("supertest");
const app = require("../../src/app");
const Badge = require("../../src/modules/badge/badgeModel");
const { badges } = require("../../src/modules/badge/badgeData");
const DailyChallenge = require("../../src/modules/game/dailyChallengeModel");
const { getCETMidnight } = require("../../src/common/utils/time");
const { useInMemoryDatabase } = require("../utils/db");
const { createAdmin, getAdminToken } = require("../utils/fixtures");

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe("end to end: a new user's first session", () => {
    useInMemoryDatabase();

    let userToken;
    let adminToken;

    beforeEach(async () => {
        await Badge.insertMany(badges);
        const admin = await createAdmin({ role: "superadmin" });
        adminToken = getAdminToken(admin._id);
    });

    const signup = () =>
        request(app).post("/auth/signup").send({
            name: "Harshal Chauhan",
            email: "journey@bazzingo.com",
            password: "secret-password",
            age: 27,
            country: "India",
        });

    it("should carry a user from signup through play, score, badge and leaderboard", async () => {
        const signupResponse = await signup();

        expect(signupResponse.statusCode).toBe(201);
        userToken = signupResponse.body.data.token;

        const loginResponse = await request(app).post("/auth/login").send({
            email: "journey@bazzingo.com",
            password: "secret-password",
        });

        expect(loginResponse.statusCode).toBe(200);

        const profile = await request(app).get("/user").set(bearer(userToken));

        expect(profile.statusCode).toBe(200);
        expect(profile.body.data.user.name).toBe("Harshal Chauhan");
        expect(profile.body.data.user.password).toBeUndefined();

        const createGame = await request(app)
            .post("/game/games")
            .set(bearer(adminToken))
            .send({
                name: "Logic Puzzle",
                category: "Logic",
                url: "https://games.bazzingo.com/logic",
            });

        expect(createGame.statusCode).toBe(201);
        const gameId = createGame.body.data.game._id;

        const games = await request(app).get("/game/games");

        expect(games.body.data.games).toHaveLength(1);

        const play = await request(app)
            .post("/game/play")
            .set(bearer(userToken))
            .send({ gameId });

        expect(play.statusCode).toBe(201);

        const recent = await request(app)
            .get("/game/recent")
            .set(bearer(userToken));

        expect(recent.body.data.plays).toHaveLength(1);

        const notSuggested = await request(app)
            .post("/game/score")
            .set(bearer(userToken))
            .send({ gameId, score: 190 });

        expect(notSuggested.statusCode).toBe(400);
        expect(notSuggested.body.message).toBe("Game not suggested today");

        await DailyChallenge.create({
            date: getCETMidnight(new Date()),
            games: [{ gameId, difficulty: "easy" }],
            quickAssessmentId: createGame.body.data.game._id,
        });

        const score = await request(app)
            .post("/game/score")
            .set(bearer(userToken))
            .send({ gameId, score: 190 });

        expect(score.statusCode).toBe(201);
        expect(score.body.data.score.score).toBe(190);

        const duplicate = await request(app)
            .post("/game/score")
            .set(bearer(userToken))
            .send({ gameId, score: 100 });

        expect(duplicate.statusCode).toBe(400);
        expect(duplicate.body.message).toBe(
            "Score for this game was already recorded today",
        );

        const leaderboard = await request(app)
            .get("/leaderboard")
            .set(bearer(userToken));

        expect(leaderboard.statusCode).toBe(200);
        expect(leaderboard.body.data.currentUser.name).toBe("Harshal Chauhan");
        expect(leaderboard.body.data.currentUser.game.totalScore).toBe(190);
        expect(leaderboard.body.data.currentUser.game.category.Logic).toBe(190);

        const streak = await request(app).get("/streak").set(bearer(userToken));

        expect(streak.statusCode).toBe(200);
        expect(streak.body.data.days).toHaveLength(1);

        const weekly = await request(app)
            .get("/game/stats/weekly-scores")
            .set(bearer(userToken));

        expect(
            Object.values(weekly.body.data.scores).reduce((a, b) => a + b, 0),
        ).toBe(190);

        const ranks = await request(app)
            .get("/badges/ranks-and-badges")
            .set(bearer(userToken));

        expect(ranks.statusCode).toBe(200);
        expect(ranks.body.data.gameGlobalRank).toBe(1);

        const unlocked = Object.values(ranks.body.data.badge)
            .flat()
            .filter((badge) => badge.isUnlocked)
            .map((badge) => badge.name);

        expect(unlocked).toContain("leaderboard-rookie");
        expect(unlocked).toContain("early-adopter");

        const dashboard = await request(app)
            .get("/dashboard")
            .set(bearer(userToken));

        expect(dashboard.statusCode).toBe(200);
    });
});

describe("end to end: the assessment lifecycle", () => {
    useInMemoryDatabase();

    let userToken;
    let adminToken;

    beforeEach(async () => {
        await Badge.insertMany(badges);
        const admin = await createAdmin({ role: "superadmin" });
        adminToken = getAdminToken(admin._id);

        const signup = await request(app).post("/auth/signup").send({
            name: "Harshal",
            email: "assess@bazzingo.com",
            password: "secret-password",
            age: 27,
            country: "India",
        });

        userToken = signup.body.data.token;
    });

    it("should create, question, generate, submit and report an assessment", async () => {
        const created = await request(app)
            .post("/assessment")
            .send({
                mainCategory: "iq-test",
                title: "IQ Test",
                questions: 4,
                subcategories: ["logic", "memory"],
                stripeProductId: "prod_iq",
            });

        expect(created.statusCode).toBe(201);
        const assessmentId = created.body.data.assessment._id;

        const questions = Array.from({ length: 20 }, (unused, index) => ({
            subcategory: index % 2 === 0 ? "logic" : "memory",
            questionType: "text",
            question: `Question ${index}`,
            optionsType: "text",
            options: ["a", "b", "c", "d"],
            answerIndex: index % 4,
        }));

        const added = await request(app)
            .post(`/assessment/${assessmentId}/questions`)
            .send({ questions });

        expect(added.statusCode).toBe(201);
        expect(added.body.data.count).toBe(20);

        const generated = await request(app).post(
            `/assessment/${assessmentId}/generate-quick?count=2`,
        );

        expect(generated.statusCode).toBe(201);
        expect(generated.body.data.createdCount).toBe(2);

        const listed = await request(app)
            .get("/assessment")
            .set(bearer(userToken));

        expect(listed.statusCode).toBe(200);
        expect(listed.body.data.categories).toContain("iq-test");

        const detail = await request(app).get(`/assessment/${assessmentId}`);

        expect(detail.body.data.questions).toHaveLength(20);

        const answers = detail.body.data.questions.map((question) => ({
            questionId: question._id,
            chosenIndex: question.answerIndex,
        }));

        const submitted = await request(app)
            .post("/assessment/submit")
            .set(bearer(userToken))
            .send({ type: "full", assessmentId, answers });

        expect(submitted.statusCode).toBe(201);
        expect(submitted.body.message).toBe("Full assessment score submitted");
        expect(submitted.body.data.score.totalScore).toBe(100);
        expect(submitted.body.data.outOfScore).toBe(100);

        const programScores = await request(app)
            .get("/assessment/program-score")
            .set(bearer(userToken));

        expect(
            programScores.body.data.programScore["iq-test"].programScore,
        ).toBeGreaterThan(0);

        const profile = await request(app).get("/user").set(bearer(userToken));

        expect(profile.body.data.user.iq).toBeGreaterThan(0);
        expect(profile.body.data.user.iqScores).toHaveLength(1);

        const fullScores = await request(app)
            .get("/assessment/user/full-scores")
            .set(bearer(userToken));

        expect(fullScores.body.data.scores).toHaveLength(1);
        expect(fullScores.body.data.scores[0].assessmentName).toBe("IQ Test");

        const submittedList = await request(app)
            .get("/assessment/user/submitted-full-assessments")
            .set(bearer(userToken));

        expect(submittedList.body.data.assessments).toHaveLength(1);

        const recent = await request(app)
            .get("/assessment/recent-activity")
            .set(bearer(userToken));

        expect(recent.body.data.total).toBe(1);

        const statistics = await request(app)
            .get("/assessment/statistics")
            .set(bearer(userToken));

        expect(statistics.body.data.statistics["iq-test"].isDataPresent).toBe(
            true,
        );
    });
});

describe("end to end: notifications reach the right users", () => {
    useInMemoryDatabase();

    let userToken;
    let adminToken;

    beforeEach(async () => {
        const admin = await createAdmin();
        adminToken = getAdminToken(admin._id);

        const signup = await request(app).post("/auth/signup").send({
            name: "Harshal",
            email: "notify@bazzingo.com",
            password: "secret-password",
            age: 27,
            country: "India",
        });

        userToken = signup.body.data.token;
    });

    it("should deliver, list and acknowledge a notification", async () => {
        const created = await request(app)
            .post("/notifications")
            .set(bearer(adminToken))
            .send({
                title: "New assessment",
                body: "A new IQ test is available",
                target: { type: "ALL" },
            });

        expect(created.statusCode).toBe(201);
        const notificationId = created.body.data.notification._id;

        const mine = await request(app)
            .get("/notifications/my-notifications")
            .set(bearer(userToken));

        expect(mine.body.data.total).toBe(1);
        expect(mine.body.data.unreadCount).toBe(1);

        const acknowledged = await request(app)
            .post(`/notifications/${notificationId}/acknowledge`)
            .set(bearer(userToken));

        expect(acknowledged.statusCode).toBe(200);

        const afterRead = await request(app)
            .get("/notifications/my-notifications")
            .set(bearer(userToken));

        expect(afterRead.body.data.total).toBe(1);
        expect(afterRead.body.data.unreadCount).toBe(0);

        const targeted = await request(app)
            .post("/notifications")
            .set(bearer(adminToken))
            .send({
                title: "Germans only",
                body: "Nur fur Deutschland",
                target: {
                    type: "CRITERIA",
                    criteria: { countries: ["germany"] },
                },
            });

        expect(targeted.statusCode).toBe(201);

        const stillOne = await request(app)
            .get("/notifications/my-notifications")
            .set(bearer(userToken));

        expect(stillOne.body.data.total).toBe(1);
    });
});

describe("end to end: account deletion locks the account everywhere", () => {
    useInMemoryDatabase();

    let userToken;

    beforeEach(async () => {
        const signup = await request(app).post("/auth/signup").send({
            name: "Harshal",
            email: "gone@bazzingo.com",
            password: "secret-password",
            age: 27,
            country: "India",
        });

        userToken = signup.body.data.token;
    });

    it("should export data, delete the account and lock every door after", async () => {
        const exported = await request(app)
            .get("/user/data-export")
            .set(bearer(userToken));

        expect(exported.statusCode).toBe(200);
        expect(exported.body.data.export.subject.email).toBe(
            "gone@bazzingo.com",
        );

        const deleted = await request(app)
            .post("/user/delete-account")
            .set(bearer(userToken))
            .send({ reason: "Not using it" });

        expect(deleted.statusCode).toBe(200);

        const profile = await request(app).get("/user").set(bearer(userToken));

        expect(profile.statusCode).toBe(403);
        expect(profile.body.context.reason).toBe("account_deleted");

        const login = await request(app).post("/auth/login").send({
            email: "gone@bazzingo.com",
            password: "secret-password",
        });

        expect(login.statusCode).toBe(403);

        const signupAgain = await request(app).post("/auth/signup").send({
            name: "Harshal",
            email: "gone@bazzingo.com",
            password: "secret-password",
        });

        expect(signupAgain.statusCode).toBe(403);

        const forgot = await request(app)
            .post("/auth/forgot-password")
            .send({ email: "gone@bazzingo.com" });

        expect(forgot.statusCode).toBe(200);
        expect(forgot.body.message).toBe(
            "If the email is registered, a password reset link has been sent.",
        );
    });
});

describe("end to end: the landing page funnel", () => {
    useInMemoryDatabase();

    it("should create a hook, sign up, refresh the token and reach the app", async () => {
        const hook = await request(app).post("/lp/hook/create").send({
            uuid: "hook-uuid-1",
            email: "funnel@bazzingo.com",
            name: "Funnel User",
            utm_source: "google",
            utm_campaign: "spring",
            utm_medium: "cpc",
        });

        expect([200, 201]).toContain(hook.statusCode);

        const resumed = await request(app).get("/lp/hook/resume/hook-uuid-1");

        expect(resumed.statusCode).toBe(200);

        const signup = await request(app).post("/auth/signup-lp").send({
            name: "Funnel User",
            email: "funnel@bazzingo.com",
            age: 30,
            country: "India",
            landingPageName: "iq-lp",
            uuid: "hook-uuid-1",
        });

        expect(signup.statusCode).toBe(201);
        const shortToken = signup.body.data.token;

        const refreshed = await request(app)
            .post("/auth/refresh-token-lp")
            .send({ token: shortToken });

        expect(refreshed.statusCode).toBe(200);

        const profile = await request(app)
            .get("/user")
            .set(bearer(refreshed.body.data.token));

        expect(profile.statusCode).toBe(200);
        expect(profile.body.data.user.landingPageName).toBe("iq-lp");
    });
});

describe("end to end: unconfigured integrations degrade instead of crashing", () => {
    useInMemoryDatabase();

    it("should answer every unconfigured integration endpoint without a crash", async () => {
        const admin = await createAdmin();
        const adminToken = getAdminToken(admin._id);

        const signup = await request(app).post("/auth/signup").send({
            name: "Harshal",
            email: "integrations@bazzingo.com",
            password: "secret-password",
        });

        const userToken = signup.body.data.token;

        expect(signup.statusCode).toBe(201);

        const config = await request(app).get("/stripe-elements/config");

        expect([200, 500]).toContain(config.statusCode);
        expect(config.body.status).toBeTruthy();

        const klaviyo = await request(app).get("/klaviyo/profiles");

        expect(klaviyo.statusCode).toBeGreaterThanOrEqual(200);

        const signature = await request(app)
            .get("/helpscout/user-signature")
            .set(bearer(userToken));

        expect(signature.statusCode).toBeGreaterThanOrEqual(200);

        const translate = await request(app)
            .post("/translate")
            .send({ texts: ["hello"], targetLanguage: "de" });

        expect(translate.statusCode).toBeGreaterThanOrEqual(200);

        const plans = await request(app).get("/plans");

        expect(plans.statusCode).toBe(200);

        const health = await request(app).get("/health");

        expect(health.statusCode).toBe(200);
        expect(health.body.status).toBe("success");
    });
});
