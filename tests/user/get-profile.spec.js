const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../../src/app");
const { config } = require("../../src/config");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

describe("GET /user", () => {
    useInMemoryDatabase();

    const getProfile = (token) =>
        request(app).get("/user").set("Authorization", `Bearer ${token}`);

    describe("given a valid access token", () => {
        it("should return a 200 status code", async () => {
            const user = await createUser();

            const response = await getProfile(getAccessToken(user._id));

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            const user = await createUser();

            const response = await getProfile(getAccessToken(user._id));

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("User profile");
        });

        it("should return the authenticated user", async () => {
            const user = await createUser();

            const response = await getProfile(getAccessToken(user._id));

            expect(response.body.data.user._id).toBe(String(user._id));
            expect(response.body.data.user.email).toBe("harshal@bazzingo.com");
            expect(response.body.data.user.name).toBe("Harshal");
        });

        it("should never expose the password", async () => {
            const user = await createUser();

            const response = await getProfile(getAccessToken(user._id));

            expect(response.body.data.user.password).toBeUndefined();
        });

        it("should never expose the utm attribution fields", async () => {
            const user = await createUser({ utmSource: "google" });

            const response = await getProfile(getAccessToken(user._id));

            expect(response.body.data.user.utmSource).toBeUndefined();
            expect(response.body.data.user.utmCampaign).toBeUndefined();
            expect(response.body.data.user.utmMedium).toBeUndefined();
        });

        it("should return the default notification preferences", async () => {
            const user = await createUser();

            const response = await getProfile(getAccessToken(user._id));

            expect(response.body.data.user.preferences).toEqual({
                email: {
                    gameReminders: true,
                    newAssessmentsAvailable: true,
                    achievementAndBadgeAlerts: true,
                    weeklyPerformanceSummary: true,
                },
                push: { enablePushNotifications: true },
                newsletter: { subscribeToTipsAndNews: true },
            });
        });
    });

    describe("given no or an invalid access token", () => {
        it("should return a 401 when the header is missing", async () => {
            const response = await request(app).get("/user");

            expect(response.statusCode).toBe(401);
            expect(response.body.status).toBe("error");
        });

        it("should return a 401 when the scheme is not Bearer", async () => {
            const user = await createUser();

            const response = await request(app)
                .get("/user")
                .set("Authorization", `Token ${getAccessToken(user._id)}`);

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 when the token is malformed", async () => {
            const response = await getProfile("not-a-token");

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 when the token is signed with another secret", async () => {
            const user = await createUser();
            const token = jwt.sign({ userId: String(user._id) }, "other");

            const response = await getProfile(token);

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 when the token has expired", async () => {
            const user = await createUser();
            const token = jwt.sign(
                { userId: String(user._id) },
                config.JWT_SECRET,
                { expiresIn: "-1h" },
            );

            const response = await getProfile(token);

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 when the user no longer exists", async () => {
            const token = getAccessToken(new mongoose.Types.ObjectId());

            const response = await getProfile(token);

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given a soft deleted account", () => {
        it("should return a 403 status code", async () => {
            const user = await createUser({
                isDeleted: true,
                deletedAt: new Date(),
            });

            const response = await getProfile(getAccessToken(user._id));

            expect(response.statusCode).toBe(403);
        });

        it("should return the account_deleted reason", async () => {
            const user = await createUser({ isDeleted: true });

            const response = await getProfile(getAccessToken(user._id));

            expect(response.body.context.reason).toBe("account_deleted");
        });
    });
});
