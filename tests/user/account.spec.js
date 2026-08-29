const request = require("supertest");
const express = require("express");
const { KLAVIYO_EVENTS } = require("../../src/constants");
const requestLogger = require("../../src/common/middlewares/requestLogger");
const globalErrorHandler = require("../../src/common/middlewares/globalErrorHandler");
const { requireAuth } = require("../../src/common/middlewares/authenticate");
const { asyncWrapper } = require("../../src/common/utils/wrapper");
const logger = require("../../src/config/logger");
const {
    UserAccountController,
} = require("../../src/modules/user/userAccountController");
const { UserDataService } = require("../../src/modules/user/userDataService");
const AccountDeletionFeedback = require("../../src/modules/user/accountDeletionFeedbackModel");
const User = require("../../src/modules/user/userModel");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const PushSubscription = require("../../src/modules/push/pushSubscriptionModel");
const Subscription = require("../../src/modules/stripe/subscriptionModel");
const Order = require("../../src/modules/stripe/orderModel");
const GameScore = require("../../src/modules/game/gameScoreModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");
const { createGame } = require("../utils/gameFixtures");

const klaviyoService = {
    upsertProfileByEmail: jest.fn(async () => undefined),
    createEvent: jest.fn(async () => undefined),
};

const stripeClient = {
    customers: { update: jest.fn(async () => ({})) },
};

const controller = new UserAccountController(
    new UserDataService(logger),
    klaviyoService,
    stripeClient,
    logger,
);

const app = express();
app.use(express.json());
app.use(requestLogger);
app.use(requireAuth);
app.get(
    "/user/data-export",
    asyncWrapper(controller.exportUserData.bind(controller)),
);
app.post(
    "/user/delete-account",
    asyncWrapper(controller.deleteAccount.bind(controller)),
);
app.use(globalErrorHandler);

beforeEach(() => {
    jest.clearAllMocks();
    klaviyoService.upsertProfileByEmail.mockResolvedValue(undefined);
    klaviyoService.createEvent.mockResolvedValue(undefined);
    stripeClient.customers.update.mockResolvedValue({});
});

const liveSubscription = (user, overrides = {}) =>
    Subscription.create({
        userId: user._id,
        status: "active",
        stripeSubscriptionId: `sub_${Date.now()}_${Math.random()}`,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86400000),
        ...overrides,
    });

describe("GET /user/data-export", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const exportData = () =>
        request(app)
            .get("/user/data-export")
            .set("Authorization", `Bearer ${token}`);

    it("should return the success envelope", async () => {
        const response = await exportData();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Your personal data export is ready",
        );
    });

    it("should stamp the version and the subject", async () => {
        const response = await exportData();

        const dataExport = response.body.data.export;
        expect(dataExport.exportVersion).toBe("1.0");
        expect(dataExport.generatedAt).toBeTruthy();
        expect(dataExport.subject).toEqual({
            userId: String(user._id),
            name: "Harshal",
            email: "harshal@bazzingo.com",
        });
    });

    it("should never expose the password or the utm fields", async () => {
        const response = await exportData();

        const account = response.body.data.export.data.account;
        expect(account.password).toBeUndefined();
        expect(account.utmSource).toBeUndefined();
        expect(account.utmCampaign).toBeUndefined();
        expect(account.utmMedium).toBeUndefined();
    });

    it("should carry every section", async () => {
        const response = await exportData();

        const data = response.body.data.export.data;
        expect(Object.keys(data).sort()).toEqual([
            "account",
            "achievements",
            "activity",
            "assessments",
            "billing",
            "games",
            "leaderboard",
            "notifications",
        ]);
    });

    it("should include the user's own records", async () => {
        const game = await createGame();
        await GameScore.create({
            userId: user._id,
            gameId: game._id,
            score: 10,
            suggestedDate: new Date(),
        });
        await Order.create({
            userId: user._id,
            status: "succeeded",
            itemType: "assessment",
        });

        const response = await exportData();

        const data = response.body.data.export.data;
        expect(data.games.scores).toHaveLength(1);
        expect(data.billing.orders).toHaveLength(1);
    });

    it("should count the records in the summary", async () => {
        const game = await createGame();
        await GameScore.create({
            userId: user._id,
            gameId: game._id,
            score: 10,
            suggestedDate: new Date(),
        });

        const response = await exportData();

        expect(response.body.data.export.summary.gameRecords).toBe(1);
    });

    it("should never include another user's records", async () => {
        const other = await createUser({ email: "other@bazzingo.com" });
        const game = await createGame();
        await GameScore.create({
            userId: other._id,
            gameId: game._id,
            score: 10,
            suggestedDate: new Date(),
        });

        const response = await exportData();

        expect(response.body.data.export.data.games.scores).toEqual([]);
    });

    it("should return empty v2 billing sections", async () => {
        const response = await exportData();

        const billing = response.body.data.export.data.billing;
        expect(billing.payments).toEqual([]);
        expect(billing.subscriptions).toEqual([]);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/user/data-export");

        expect(response.statusCode).toBe(401);
    });
});

describe("POST /user/delete-account", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser({ stripeCustomerId: "cus_1" });
        token = getAccessToken(user._id);
    });

    const deleteAccount = (body = {}) =>
        request(app)
            .post("/user/delete-account")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    it("should return the success envelope", async () => {
        const response = await deleteAccount();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Your account has been deleted");
    });

    it("should soft delete the user, never remove it", async () => {
        await deleteAccount({ reason: "Too expensive" });

        const updated = await User.findById(user._id);
        expect(updated).not.toBeNull();
        expect(updated.isDeleted).toBe(true);
        expect(updated.deletedAt).toBeInstanceOf(Date);
        expect(updated.deletionReason).toBe("Too expensive");
    });

    it("should turn every notification preference off", async () => {
        await deleteAccount();

        const updated = await User.findById(user._id);
        expect(updated.preferences.email.gameReminders).toBe(false);
        expect(updated.preferences.push.enablePushNotifications).toBe(false);
        expect(updated.preferences.newsletter.subscribeToTipsAndNews).toBe(
            false,
        );
    });

    it("should record the deletion feedback", async () => {
        await deleteAccount({
            reason: "  Too expensive  ",
            wouldHaveStayedIfOffered: ["discount", 42, "pause"],
        });

        const feedback = await AccountDeletionFeedback.findOne({
            userId: user._id,
        });
        expect(feedback.reason).toBe("Too expensive");
        expect(feedback.wouldHaveStayedIfOffered).toEqual([
            "discount",
            "pause",
        ]);
        expect(feedback.source).toBe("web");
    });

    it("should store a null reason when none is given", async () => {
        await deleteAccount();

        const feedback = await AccountDeletionFeedback.findOne({
            userId: user._id,
        });
        expect(feedback.reason).toBeNull();
    });

    it("should drop the user out of the leaderboard", async () => {
        await Leaderboard.create({ userId: user._id, name: "Harshal" });

        await deleteAccount();

        const row = await Leaderboard.findOne({ userId: user._id });
        expect(row.isDeleted).toBe(true);
    });

    it("should deactivate the push subscriptions", async () => {
        await PushSubscription.create({
            userId: user._id,
            endpoint: "https://push.example.com/1",
            keys: { p256dh: "a", auth: "b" },
        });

        await deleteAccount();

        const subscription = await PushSubscription.findOne({
            userId: user._id,
        });
        expect(subscription.isActive).toBe(false);
    });

    it("should flag the account deleted in klaviyo", async () => {
        await deleteAccount({ reason: "Too expensive" });

        expect(klaviyoService.upsertProfileByEmail).toHaveBeenCalledTimes(1);
        expect(klaviyoService.createEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                metricName: KLAVIYO_EVENTS.ACCOUNT_DELETED,
            }),
        );
    });

    it("should flag the stripe customer", async () => {
        await deleteAccount();

        expect(stripeClient.customers.update).toHaveBeenCalledWith(
            "cus_1",
            expect.objectContaining({
                metadata: expect.objectContaining({
                    bazingo_account_deleted: "true",
                }),
            }),
        );
    });

    it("should still delete when klaviyo fails", async () => {
        klaviyoService.upsertProfileByEmail.mockRejectedValueOnce(
            new Error("klaviyo is down"),
        );

        const response = await deleteAccount();

        expect(response.statusCode).toBe(200);
        expect((await User.findById(user._id)).isDeleted).toBe(true);
    });

    it("should still delete when stripe fails", async () => {
        stripeClient.customers.update.mockRejectedValueOnce(
            new Error("stripe is down"),
        );

        const response = await deleteAccount();

        expect(response.statusCode).toBe(200);
        expect((await User.findById(user._id)).isDeleted).toBe(true);
    });

    it("should return a 409 when a live subscription blocks it", async () => {
        await liveSubscription(user);

        const response = await deleteAccount();

        expect(response.statusCode).toBe(409);
        expect(response.body.message).toBe(
            "Please cancel your active subscription before deleting your account.",
        );
        expect(response.body.context.reason).toBe("active_subscription");
    });

    it("should allow deletion when the subscription is cancelling", async () => {
        await liveSubscription(user, { cancelAtPeriodEnd: true });

        const response = await deleteAccount();

        expect(response.statusCode).toBe(200);
    });

    it("should not delete anything when blocked", async () => {
        await liveSubscription(user);

        await deleteAccount();

        expect((await User.findById(user._id)).isDeleted).toBe(false);
        expect(await AccountDeletionFeedback.countDocuments()).toBe(0);
    });

    it("should return a 403 for an already deleted account", async () => {
        const deleted = await createUser({
            email: "gone@bazzingo.com",
            isDeleted: true,
        });

        const response = await request(app)
            .post("/user/delete-account")
            .set("Authorization", `Bearer ${getAccessToken(deleted._id)}`)
            .send({});

        expect(response.statusCode).toBe(403);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).post("/user/delete-account");

        expect(response.statusCode).toBe(401);
    });
});
