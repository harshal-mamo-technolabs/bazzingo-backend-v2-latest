const crypto = require("crypto");
const logger = require("../../src/config/logger");
const { config } = require("../../src/config");
const { KLAVIYO_EVENTS } = require("../../src/constants");
const {
    AssessmentService,
} = require("../../src/modules/assessment/assessmentService");
const {
    LeaderboardService,
} = require("../../src/modules/leaderboard/leaderboardService");
const {
    KlaviyoSyncService,
    funnelStage,
    buildResumeUrl,
} = require("../../src/modules/lp/klaviyoSyncService");
const LandingPageHook = require("../../src/modules/lp/landingPageHookModel");
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
};

const buildService = () =>
    new KlaviyoSyncService(
        logger,
        klaviyoService,
        new AssessmentService(logger),
        new LeaderboardService(logger),
    );

const properties = () =>
    klaviyoService.upsertProfileByEmail.mock.calls[0][0].properties;

const eventByName = (metricName) =>
    klaviyoService.createEvent.mock.calls
        .map((call) => call[0])
        .find((event) => event.metricName === metricName);

describe("funnelStage", () => {
    it("should return landing without a hook", () => {
        expect(funnelStage(null)).toBe("landing");
    });

    it("should return completed once the payment is done", () => {
        expect(funnelStage({ paymentCompleted: true })).toBe("completed");
    });

    it("should return landing without an email", () => {
        expect(funnelStage({ assessmentStatus: "completed" })).toBe("landing");
    });

    it("should return quiz while the assessment is pending", () => {
        expect(
            funnelStage({
                email: "lead@bazzingo.com",
                assessmentStatus: "pending",
            }),
        ).toBe("quiz");
    });

    it("should return details when the name is missing", () => {
        expect(
            funnelStage({
                email: "lead@bazzingo.com",
                assessmentStatus: "completed",
            }),
        ).toBe("details");
    });

    it("should return checkout once the details are captured", () => {
        expect(
            funnelStage({
                email: "lead@bazzingo.com",
                assessmentStatus: "completed",
                name: "Lead",
            }),
        ).toBe("checkout");
    });

    it("should stay on checkout when the payment was only initiated", () => {
        expect(
            funnelStage({
                email: "lead@bazzingo.com",
                assessmentStatus: "completed",
                name: "Lead",
                paymentInitiated: true,
            }),
        ).toBe("checkout");
    });
});

describe("buildResumeUrl", () => {
    const originalLandingPageUrl = config.LANDING_PAGE_URL;

    afterAll(() => {
        config.LANDING_PAGE_URL = originalLandingPageUrl;
    });

    it("should trim the trailing slash and encode the uuid", () => {
        config.LANDING_PAGE_URL = "https://lp.example.com/";

        expect(buildResumeUrl("u 1")).toBe(
            "https://lp.example.com/#/resume?uuid=u%201&utm_email=klaviyo",
        );
    });

    it("should return nothing without a configured landing page url", () => {
        config.LANDING_PAGE_URL = "";

        expect(buildResumeUrl("u1")).toBeUndefined();
    });

    it("should return nothing without a uuid", () => {
        config.LANDING_PAGE_URL = "https://lp.example.com";

        expect(buildResumeUrl(undefined)).toBeUndefined();
    });
});

describe("syncLandingPageHook", () => {
    useInMemoryDatabase();

    const originalLandingPageUrl = config.LANDING_PAGE_URL;
    const originalFrontendUrl = config.FRONTEND_URL;

    beforeEach(() => {
        jest.clearAllMocks();
        klaviyoService.upsertProfileByEmail.mockResolvedValue({ ok: true });
        klaviyoService.createEvent.mockResolvedValue({ ok: true });
        config.LANDING_PAGE_URL = "https://lp.bazzingo.com/";
        config.FRONTEND_URL = "https://testbrain.net";
    });

    afterAll(() => {
        config.LANDING_PAGE_URL = originalLandingPageUrl;
        config.FRONTEND_URL = originalFrontendUrl;
    });

    const seedHook = (overrides = {}) =>
        LandingPageHook.create({ uuid: "hook-1", ...overrides });

    it("should skip a hook without an email", async () => {
        const hook = await seedHook();

        const result = await buildService().syncLandingPageHook({
            hook,
            previousHook: null,
            source: "hook.create",
        });

        expect(result).toEqual({ skipped: true, reason: "email missing" });
        expect(klaviyoService.upsertProfileByEmail).not.toHaveBeenCalled();
    });

    it("should upsert the profile with the funnel properties", async () => {
        const hook = await seedHook({
            email: "Lead@Bazzingo.com",
            name: "Lead",
            age: 31,
            country: "India",
            landingPageName: "iq-lp",
            questionNumber: 3,
            paymentInitiated: true,
            utmSource: "google",
            utmCampaign: "brand",
            utmMedium: "cpc",
            utmEmail: "klaviyo",
        });

        const result = await buildService().syncLandingPageHook({
            hook,
            previousHook: null,
            source: "hook.create",
        });

        expect(result).toEqual({ ok: true });
        expect(
            klaviyoService.upsertProfileByEmail.mock.calls[0][0],
        ).toMatchObject({ email: "lead@bazzingo.com", name: "Lead" });
        expect(properties()).toMatchObject({
            "payment completed": false,
            "payment initiated": true,
            "assessment status": "pending",
            "question number": 3,
            "Landing Page Name": "iq-lp",
            source: "google",
            campaign: "brand",
            medium: "cpc",
            utm_email: "klaviyo",
            Age: 31,
            Country: "India",
            Email: "lead@bazzingo.com",
            Name: "Lead",
            funnel_stage: "quiz",
            resume_url:
                "https://lp.bazzingo.com/#/resume?uuid=hook-1&utm_email=klaviyo",
        });
    });

    it("should keep email attribution separate from the original UTM medium", async () => {
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            utmSource: "google",
            utmCampaign: "brand",
            utmMedium: "cpc",
            utmEmail: "Klaviyo",
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: null,
            source: "hook.create",
        });

        expect(properties()).toMatchObject({
            source: "google",
            campaign: "brand",
            medium: "cpc",
            utm_email: "Klaviyo",
        });
    });

    it("should omit the resume url when the landing page url is not configured", async () => {
        config.LANDING_PAGE_URL = "";
        const hook = await seedHook({ email: "lead@bazzingo.com" });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: null,
            source: "hook.create",
        });

        expect(properties().resume_url).toBeUndefined();
    });

    it("should resolve the main category from the quick mini assessment", async () => {
        const full = await createFullAssessment();
        const question = await createQuestion(full);
        const mini = await createQuickMini(full, [question]);
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            assessmentId: mini._id,
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: null,
            source: "hook.create",
        });

        expect(properties().mainCategory).toBe("iq-test");
        expect(properties().assessmentId).toBe(String(mini._id));
    });

    it("should merge the leaderboard ranks of the matching user", async () => {
        const user = await createUser({ email: "lead@bazzingo.com" });
        await Leaderboard.create({
            userId: user._id,
            gameGlobalRank: 4,
            assessmentGlobalRank: 7,
        });
        const hook = await seedHook({ email: "lead@bazzingo.com" });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: null,
            source: "hook.create",
        });

        expect(properties()).toMatchObject({
            gameGlobalRank: 4,
            assessmentGlobalRank: 7,
        });
    });

    it("should prefer the user's fixed attribution over a later hook", async () => {
        await createUser({
            email: "lead@bazzingo.com",
            utmSource: "meta",
            utmCampaign: "retarget",
        });
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            utmSource: "google",
            utmCampaign: "",
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: null,
            source: "hook.create",
        });

        expect(properties().source).toBe("meta");
        expect(properties().campaign).toBe("retarget");
    });

    it("should use the user name when the hook has none", async () => {
        await createUser({ email: "lead@bazzingo.com", name: "From User" });
        const hook = await seedHook({ email: "lead@bazzingo.com" });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: null,
            source: "hook.create",
        });

        expect(klaviyoService.upsertProfileByEmail.mock.calls[0][0].name).toBe(
            "From User",
        );
    });

    it("should fire the email captured event when the email is new", async () => {
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            landingPageName: "iq-lp",
            utmSource: "google",
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: { uuid: "hook-1" },
            source: "hook.update",
        });

        const event = eventByName(KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_CAPTURED);
        expect(event.uniqueId).toBe("hook-1:LandingPageEmailCaptured");
        expect(event.properties).toMatchObject({
            "Landing Page Name": "iq-lp",
            source: "google",
        });
    });

    it("should not fire the email captured event when the email was already there", async () => {
        const hook = await seedHook({ email: "lead@bazzingo.com" });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: { uuid: "hook-1", email: "lead@bazzingo.com" },
            source: "hook.update",
        });

        expect(
            eventByName(KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_CAPTURED),
        ).toBeUndefined();
    });

    it("should fire the payment and assessment events on their transitions", async () => {
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            paymentInitiated: true,
            paymentCompleted: true,
            assessmentStatus: "completed",
            questionNumber: 10,
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: { uuid: "hook-1", email: "lead@bazzingo.com" },
            source: "hook.update",
        });

        expect(
            eventByName(KLAVIYO_EVENTS.LANDING_PAGE_PAYMENT_INITIATED).uniqueId,
        ).toBe("hook-1:LandingPagePaymentInitiated");
        expect(
            eventByName(KLAVIYO_EVENTS.LANDING_PAGE_PAYMENT_COMPLETED).uniqueId,
        ).toBe("hook-1:LandingPagePaymentCompleted");
        const assessmentEvent = eventByName(
            KLAVIYO_EVENTS.LANDING_PAGE_ASSESSMENT_COMPLETED,
        );
        expect(assessmentEvent.uniqueId).toBe(
            "hook-1:LandingPageAssessmentCompleted",
        );
        expect(assessmentEvent.properties).toMatchObject({
            "question number": 10,
            assessmentStatus: "completed",
        });
    });

    it("should add a no-expiry reset password link to the profile when the payment completed event fires", async () => {
        const user = await createUser({ email: "lead@bazzingo.com" });
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            paymentCompleted: true,
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: { uuid: "hook-1", email: "lead@bazzingo.com" },
            source: "hook.update",
        });

        const resetUrl = properties()["BAZZINGO:RESET_PASSWORD"];

        expect(resetUrl).toMatch(
            /^https:\/\/testbrain\.net\/forgot-password\/[0-9a-f]{64}$/,
        );

        const token = resetUrl.split("/forgot-password/")[1];
        const expectedHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");
        const updated = await User.findById(user._id);

        expect(updated.passwordResetToken).toBe(expectedHash);
    });

    it("should not reissue a reset password link without a payment completed transition", async () => {
        await createUser({ email: "lead@bazzingo.com" });
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            paymentCompleted: true,
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: {
                uuid: "hook-1",
                email: "lead@bazzingo.com",
                paymentCompleted: true,
            },
            source: "hook.update",
        });

        expect(properties()["BAZZINGO:RESET_PASSWORD"]).toBeUndefined();
    });

    it("should fire the email-flow payment events when the hook came back through a resume link", async () => {
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            paymentInitiated: true,
            paymentCompleted: true,
            utmEmail: "klaviyo",
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: { uuid: "hook-1", email: "lead@bazzingo.com" },
            source: "hook.update",
        });

        expect(
            eventByName(
                KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_FLOW_PAYMENT_INITIATED,
            ).uniqueId,
        ).toBe("hook-1:LandingPageEmailFlowPaymentInitiated");
        expect(
            eventByName(
                KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_FLOW_PAYMENT_COMPLETED,
            ).uniqueId,
        ).toBe("hook-1:LandingPageEmailFlowPaymentCompleted");
    });

    it("should not fire the email-flow payment events without a resume-link utm email", async () => {
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            paymentInitiated: true,
            paymentCompleted: true,
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: { uuid: "hook-1", email: "lead@bazzingo.com" },
            source: "hook.update",
        });

        expect(
            eventByName(
                KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_FLOW_PAYMENT_INITIATED,
            ),
        ).toBeUndefined();
        expect(
            eventByName(
                KLAVIYO_EVENTS.LANDING_PAGE_EMAIL_FLOW_PAYMENT_COMPLETED,
            ),
        ).toBeUndefined();
    });

    it("should not fire any event when nothing changed", async () => {
        const hook = await seedHook({
            email: "lead@bazzingo.com",
            paymentInitiated: true,
        });

        await buildService().syncLandingPageHook({
            hook,
            previousHook: {
                uuid: "hook-1",
                email: "lead@bazzingo.com",
                paymentInitiated: true,
            },
            source: "hook.update",
        });

        expect(klaviyoService.createEvent).not.toHaveBeenCalled();
    });

    it("should not throw when an event fails", async () => {
        klaviyoService.createEvent.mockRejectedValue(new Error("klaviyo down"));
        const hook = await seedHook({ email: "lead@bazzingo.com" });

        await expect(
            buildService().syncLandingPageHook({
                hook,
                previousHook: null,
                source: "hook.create",
            }),
        ).resolves.toEqual({ ok: true });
    });

    it("should throw when the profile upsert fails", async () => {
        klaviyoService.upsertProfileByEmail.mockRejectedValue(
            new Error("klaviyo down"),
        );
        const hook = await seedHook({ email: "lead@bazzingo.com" });

        await expect(
            buildService().syncLandingPageHook({
                hook,
                previousHook: null,
                source: "hook.create",
            }),
        ).rejects.toThrow("klaviyo down");
    });

    it("should accept a plain object hook", async () => {
        const result = await buildService().syncLandingPageHook({
            hook: { uuid: "hook-1", email: "lead@bazzingo.com" },
            previousHook: null,
            source: "hook.create",
        });

        expect(result).toEqual({ ok: true });
        expect(properties().funnel_stage).toBe("quiz");
    });
});
