const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { config } = require("../../src/config");
const { KLAVIYO_EVENTS } = require("../../src/constants");
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
const LandingPageHook = require("../../src/modules/lp/landingPageHookModel");
const User = require("../../src/modules/user/userModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");

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
    app.post("/lp/hook/create", handler("createLpHook"));
    app.patch("/lp/hook/update/:uuid", handler("updateLpHook"));
    app.get("/lp/hook/resume/:uuid", handler("resumeLpHook"));
    app.use(globalErrorHandler);

    return app;
};

const app = buildApp();

const eventNames = () =>
    klaviyoService.createEvent.mock.calls.map((call) => call[0].metricName);

const profileProperties = () =>
    klaviyoService.upsertProfileByEmail.mock.calls[0][0].properties;

beforeEach(() => {
    jest.clearAllMocks();
    klaviyoService.upsertProfileByEmail.mockResolvedValue({ ok: true });
    klaviyoService.createEvent.mockResolvedValue({ ok: true });
});

describe("POST /lp/hook/create", () => {
    useInMemoryDatabase();

    const create = (body) => request(app).post("/lp/hook/create").send(body);

    it("should return a 400 when the uuid is missing", async () => {
        const response = await create({ email: "lead@bazzingo.com" });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("UUID is required");
    });

    it("should create a hook with the default utm values", async () => {
        const response = await create({ uuid: "hook-1" });

        expect(response.statusCode).toBe(201);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Hook created");
        expect(response.body.data.hook).toMatchObject({
            uuid: "hook-1",
            utmSource: "default",
            utmCampaign: "default",
            utmMedium: "default",
            paymentCompleted: false,
            paymentInitiated: false,
            assessmentStatus: "pending",
            questionNumber: 0,
        });
    });

    it("should store the utm parameters sent in snake case", async () => {
        await create({
            uuid: "hook-1",
            utm_source: "google",
            utm_campaign: "brand",
            utm_medium: "cpc",
        });

        const hook = await LandingPageHook.findOne({ uuid: "hook-1" });
        expect(hook.utmSource).toBe("google");
        expect(hook.utmCampaign).toBe("brand");
        expect(hook.utmMedium).toBe("cpc");
    });

    it("should update an existing hook instead of creating a second one", async () => {
        await create({ uuid: "hook-1", email: "lead@bazzingo.com" });

        const response = await create({ uuid: "hook-1", name: "Lead" });

        expect(response.statusCode).toBe(201);
        expect(response.body.data.hook.name).toBe("Lead");
        expect(response.body.data.hook.email).toBe("lead@bazzingo.com");
        expect(await LandingPageHook.countDocuments()).toBe(1);
    });

    it("should ignore null values when updating an existing hook", async () => {
        await create({ uuid: "hook-1", name: "Lead" });

        await create({ uuid: "hook-1", name: null });

        const hook = await LandingPageHook.findOne({ uuid: "hook-1" });
        expect(hook.name).toBe("Lead");
    });

    it("should not touch klaviyo or help scout when the hook has no email", async () => {
        await create({ uuid: "hook-1" });

        expect(klaviyoService.upsertProfileByEmail).not.toHaveBeenCalled();
        expect(
            helpscoutService.scheduleSyncContactUtmToHelpScout,
        ).not.toHaveBeenCalled();
    });

    it("should upsert the klaviyo profile when the hook has an email", async () => {
        await create({
            uuid: "hook-1",
            email: "Lead@Bazzingo.com",
            name: "Lead",
            landingPageName: "iq-lp",
        });

        expect(klaviyoService.upsertProfileByEmail).toHaveBeenCalledTimes(1);
        expect(
            klaviyoService.upsertProfileByEmail.mock.calls[0][0],
        ).toMatchObject({ email: "lead@bazzingo.com", name: "Lead" });
        expect(profileProperties()).toMatchObject({
            "Landing Page Name": "iq-lp",
            funnel_stage: "quiz",
            Email: "lead@bazzingo.com",
            Name: "Lead",
        });
    });

    it("should fire the email captured event", async () => {
        await create({ uuid: "hook-1", email: "lead@bazzingo.com" });

        expect(eventNames()).toContain(
            KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_CAPTURED,
        );
        expect(klaviyoService.createEvent.mock.calls[0][0].uniqueId).toBe(
            "hook-1:LandingPageEmailCaptured",
        );
    });

    it("should still return a 201 when the klaviyo sync fails", async () => {
        klaviyoService.upsertProfileByEmail.mockRejectedValue(
            new Error("klaviyo down"),
        );

        const response = await create({
            uuid: "hook-1",
            email: "lead@bazzingo.com",
        });

        expect(response.statusCode).toBe(201);
        expect(response.body.message).toBe("Hook created");
        expect(await LandingPageHook.countDocuments()).toBe(1);
    });

    it("should schedule the help scout contact sync", async () => {
        await create({
            uuid: "hook-1",
            email: "lead@bazzingo.com",
            name: "Lead",
            utm_source: "google",
        });

        expect(
            helpscoutService.scheduleSyncContactUtmToHelpScout,
        ).toHaveBeenCalledWith({
            email: "lead@bazzingo.com",
            name: "Lead",
            utmSource: "google",
            utmCampaign: "default",
            utmMedium: "default",
        });
    });

    it("should backfill the real utm values onto a matching user", async () => {
        const user = await createUser({ email: "lead@bazzingo.com" });

        await create({
            uuid: "hook-1",
            email: "Lead@Bazzingo.com",
            utm_source: "google",
        });

        const updated = await User.findById(user._id);
        expect(updated.utmSource).toBe("google");
        expect(updated.utmCampaign).toBe("default");
    });

    it("should never overwrite a real utm value already on the user", async () => {
        const user = await createUser({
            email: "lead@bazzingo.com",
            utmSource: "meta",
        });

        await create({
            uuid: "hook-1",
            email: "lead@bazzingo.com",
            utm_source: "google",
        });

        const updated = await User.findById(user._id);
        expect(updated.utmSource).toBe("meta");
    });

    it("should not backfill when the hook only carries default utm values", async () => {
        const user = await createUser({ email: "lead@bazzingo.com" });

        await create({ uuid: "hook-1", email: "lead@bazzingo.com" });

        const updated = await User.findById(user._id);
        expect(updated.utmSource).toBe("default");
    });
});

describe("PATCH /lp/hook/update/:uuid", () => {
    useInMemoryDatabase();

    const update = (uuid, body) =>
        request(app).patch(`/lp/hook/update/${uuid}`).send(body);

    const seedHook = (overrides = {}) =>
        LandingPageHook.create({ uuid: "hook-1", ...overrides });

    it("should return a 404 when the hook does not exist", async () => {
        const response = await update("missing", { name: "Lead" });

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Hook not found");
    });

    it("should update the allowed fields", async () => {
        await seedHook({ email: "lead@bazzingo.com" });

        const response = await update("hook-1", {
            name: "Lead",
            age: 31,
            country: "India",
            questionNumber: 4,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Hook updated");
        expect(response.body.data.hook).toMatchObject({
            name: "Lead",
            age: 31,
            country: "India",
            questionNumber: 4,
        });
    });

    it("should ignore fields that are not updatable", async () => {
        await seedHook();

        await update("hook-1", { uuid: "hacked", createdAt: "2020-01-01" });

        const hook = await LandingPageHook.findOne({ uuid: "hook-1" });
        expect(hook).toBeTruthy();
    });

    it("should apply the utm values sent with the update", async () => {
        await seedHook({ email: "lead@bazzingo.com" });

        await update("hook-1", { utm_source: "google" });

        const hook = await LandingPageHook.findOne({ uuid: "hook-1" });
        expect(hook.utmSource).toBe("google");
        expect(hook.utmMedium).toBe("default");
    });

    it("should fire the payment initiated event on the transition", async () => {
        await seedHook({ email: "lead@bazzingo.com" });

        await update("hook-1", { paymentInitiated: true });

        expect(eventNames()).toContain(
            KLAVIYO_EVENTS.LANDING_PAGE_PAYMENT_INITIATED,
        );
        expect(eventNames()).not.toContain(
            KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_CAPTURED,
        );
    });

    it("should fire the payment completed and assessment completed events once", async () => {
        await seedHook({ email: "lead@bazzingo.com" });

        await update("hook-1", {
            paymentCompleted: true,
            assessmentStatus: "completed",
        });
        const firstRun = eventNames();

        klaviyoService.createEvent.mockClear();
        await update("hook-1", { paymentCompleted: true });

        expect(firstRun).toContain(KLAVIYO_EVENTS.LANDING_PAGE_PAYMENT_COMPLETED);
        expect(firstRun).toContain(
            KLAVIYO_EVENTS.LANDING_PAGE_ASSESSMENT_COMPLETED,
        );
        expect(eventNames()).toHaveLength(0);
    });

    it("should still return a 200 when the klaviyo sync fails", async () => {
        await seedHook({ email: "lead@bazzingo.com" });
        klaviyoService.upsertProfileByEmail.mockRejectedValue(
            new Error("klaviyo down"),
        );

        const response = await update("hook-1", { name: "Lead" });

        expect(response.statusCode).toBe(200);
        expect(response.body.data.hook.name).toBe("Lead");
    });

    it("should schedule the help scout contact sync", async () => {
        await seedHook({ email: "lead@bazzingo.com" });

        await update("hook-1", { name: "Lead" });

        expect(
            helpscoutService.scheduleSyncContactUtmToHelpScout,
        ).toHaveBeenCalledTimes(1);
    });

    it("should not sync anything when the hook has no email", async () => {
        await seedHook();

        await update("hook-1", { name: "Lead" });

        expect(klaviyoService.upsertProfileByEmail).not.toHaveBeenCalled();
        expect(
            helpscoutService.scheduleSyncContactUtmToHelpScout,
        ).not.toHaveBeenCalled();
    });
});

describe("GET /lp/hook/resume/:uuid", () => {
    useInMemoryDatabase();

    const resume = (uuid, query = "") =>
        request(app).get(`/lp/hook/resume/${uuid}${query}`);

    const seedHook = (overrides = {}) =>
        LandingPageHook.create({ uuid: "hook-1", ...overrides });

    it("should return a 404 when the hook does not exist", async () => {
        const response = await resume("missing");

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Hook not found");
    });

    it("should return the landing stage when the hook has no email", async () => {
        await seedHook();

        const response = await resume("hook-1");

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Hook resumed");
        expect(response.body.data).toMatchObject({
            stage: "landing",
            token: null,
            answers: [],
            assessmentId: null,
        });
    });

    it("should return the quiz stage while the assessment is pending", async () => {
        await seedHook({ email: "lead@bazzingo.com" });

        const response = await resume("hook-1");

        expect(response.body.data.stage).toBe("quiz");
    });

    it("should return the details stage when the name is still missing", async () => {
        await seedHook({
            email: "lead@bazzingo.com",
            assessmentStatus: "completed",
        });

        const response = await resume("hook-1");

        expect(response.body.data.stage).toBe("details");
    });

    it("should return the completed stage once the payment is done", async () => {
        await seedHook({
            email: "lead@bazzingo.com",
            paymentCompleted: true,
        });

        const response = await resume("hook-1");

        expect(response.body.data.stage).toBe("completed");
    });

    it("should mint a 30 minute token at the checkout stage", async () => {
        const user = await createUser({ email: "lead@bazzingo.com" });
        await seedHook({
            email: "lead@bazzingo.com",
            name: "Lead",
            assessmentStatus: "completed",
        });

        const response = await resume("hook-1");

        expect(response.body.data.stage).toBe("checkout");
        const decoded = jwt.verify(response.body.data.token, config.JWT_SECRET);
        expect(decoded.userId).toBe(String(user._id));
        expect(decoded.exp - decoded.iat).toBe(30 * 60);
    });

    it("should not mint a token for a deleted account", async () => {
        await createUser({ email: "lead@bazzingo.com", isDeleted: true });
        await seedHook({
            email: "lead@bazzingo.com",
            name: "Lead",
            assessmentStatus: "completed",
        });

        const response = await resume("hook-1");

        expect(response.body.data.stage).toBe("checkout");
        expect(response.body.data.token).toBeNull();
    });

    it("should not mint a token when no user matches the hook email", async () => {
        await seedHook({
            email: "lead@bazzingo.com",
            name: "Lead",
            assessmentStatus: "completed",
        });

        const response = await resume("hook-1");

        expect(response.body.data.token).toBeNull();
    });

    it("should return the stored hook payload", async () => {
        const assessmentId = new mongoose.Types.ObjectId();
        await seedHook({
            email: "lead@bazzingo.com",
            name: "Lead",
            age: 31,
            country: "India",
            assessmentId,
            answers: [{ questionId: "q1", chosenIndex: 2 }],
        });

        const response = await resume("hook-1");

        expect(response.body.data).toMatchObject({
            email: "lead@bazzingo.com",
            name: "Lead",
            age: 31,
            country: "India",
            assessmentId: String(assessmentId),
            answers: [{ questionId: "q1", chosenIndex: 2 }],
        });
    });

    it("should persist the utm email and fire the resume event", async () => {
        await seedHook({ email: "lead@bazzingo.com" });

        const response = await resume("hook-1", "?utm_email=klaviyo");

        expect(response.statusCode).toBe(200);
        const hook = await LandingPageHook.findOne({ uuid: "hook-1" });
        expect(hook.utmEmail).toBe("klaviyo");
        expect(eventNames()).toContain(
            KLAVIYO_EVENTS.LANDING_PAGE_RESUMED_FROM_EMAIL,
        );
        const resumeEvent = klaviyoService.createEvent.mock.calls
            .map((call) => call[0])
            .find(
                (event) =>
                    event.metricName ===
                    KLAVIYO_EVENTS.LANDING_PAGE_RESUMED_FROM_EMAIL,
            );
        expect(resumeEvent.uniqueId).toBe("hook-1:Resumed:quiz");
        expect(resumeEvent.properties).toMatchObject({
            stage: "quiz",
            utm_email: "klaviyo",
        });
    });

    it("should not fire the resume event without a utm email", async () => {
        await seedHook({ email: "lead@bazzingo.com" });

        await resume("hook-1");

        expect(eventNames()).not.toContain(
            KLAVIYO_EVENTS.LANDING_PAGE_RESUMED_FROM_EMAIL,
        );
    });

    it("should not re-fire a stage event when only the utm email changes", async () => {
        await seedHook({
            email: "lead@bazzingo.com",
            paymentInitiated: true,
        });

        await resume("hook-1", "?utm_email=klaviyo");

        expect(eventNames()).not.toContain(
            KLAVIYO_EVENTS.LANDING_PAGE_PAYMENT_INITIATED,
        );
    });

    it("should still return a 200 when the klaviyo sync fails", async () => {
        await seedHook({ email: "lead@bazzingo.com" });
        klaviyoService.upsertProfileByEmail.mockRejectedValue(
            new Error("klaviyo down"),
        );

        const response = await resume("hook-1", "?utm_email=klaviyo");

        expect(response.statusCode).toBe(200);
        expect(response.body.data.stage).toBe("quiz");
    });

    it("should still return a 200 when the resume event fails", async () => {
        await seedHook({ email: "lead@bazzingo.com" });
        klaviyoService.createEvent.mockRejectedValue(new Error("klaviyo down"));

        const response = await resume("hook-1", "?utm_email=klaviyo");

        expect(response.statusCode).toBe(200);
    });

    it("should not sync klaviyo when the hook has no email", async () => {
        await seedHook();

        await resume("hook-1", "?utm_email=klaviyo");

        expect(klaviyoService.upsertProfileByEmail).not.toHaveBeenCalled();
        expect(klaviyoService.createEvent).not.toHaveBeenCalled();
    });
});
