const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../src/app");
const User = require("../../src/modules/user/userModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

describe("PUT /user/preferences", () => {
    useInMemoryDatabase();

    const updatePreferences = (token, body) =>
        request(app)
            .put("/user/preferences")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    describe("given valid preferences", () => {
        it("should return a 200 status code", async () => {
            const user = await createUser();

            const response = await updatePreferences(getAccessToken(user._id), {
                email: { gameReminders: false },
            });

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            const user = await createUser();

            const response = await updatePreferences(getAccessToken(user._id), {
                email: { gameReminders: false },
            });

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe(
                "Notification preferences updated",
            );
        });

        it("should return the full preferences object", async () => {
            const user = await createUser();

            const response = await updatePreferences(getAccessToken(user._id), {
                email: { gameReminders: false },
            });

            expect(response.body.data.preferences.email.gameReminders).toBe(
                false,
            );
            expect(
                response.body.data.preferences.push.enablePushNotifications,
            ).toBe(true);
        });

        it("should persist every section that was sent", async () => {
            const user = await createUser();

            await updatePreferences(getAccessToken(user._id), {
                email: {
                    gameReminders: false,
                    newAssessmentsAvailable: false,
                    achievementAndBadgeAlerts: false,
                    weeklyPerformanceSummary: false,
                },
                push: { enablePushNotifications: false },
                newsletter: { subscribeToTipsAndNews: false },
            });

            const updated = await User.findById(user._id);
            expect(updated.preferences.email.gameReminders).toBe(false);
            expect(updated.preferences.email.newAssessmentsAvailable).toBe(
                false,
            );
            expect(updated.preferences.email.achievementAndBadgeAlerts).toBe(
                false,
            );
            expect(updated.preferences.email.weeklyPerformanceSummary).toBe(
                false,
            );
            expect(updated.preferences.push.enablePushNotifications).toBe(
                false,
            );
            expect(updated.preferences.newsletter.subscribeToTipsAndNews).toBe(
                false,
            );
        });

        it("should leave the untouched keys of a section as they were", async () => {
            const user = await createUser();

            await updatePreferences(getAccessToken(user._id), {
                email: { gameReminders: false },
            });

            const updated = await User.findById(user._id);
            expect(updated.preferences.email.gameReminders).toBe(false);
            expect(updated.preferences.email.weeklyPerformanceSummary).toBe(
                true,
            );
        });

        it("should coerce truthy and falsy values to booleans", async () => {
            const user = await createUser();

            await updatePreferences(getAccessToken(user._id), {
                email: { gameReminders: 0 },
                push: { enablePushNotifications: 1 },
            });

            const updated = await User.findById(user._id);
            expect(updated.preferences.email.gameReminders).toBe(false);
            expect(updated.preferences.push.enablePushNotifications).toBe(true);
        });

        it("should ignore unknown keys inside a known section", async () => {
            const user = await createUser();

            const response = await updatePreferences(getAccessToken(user._id), {
                email: { gameReminders: false, smsAlerts: true },
            });

            expect(response.statusCode).toBe(200);
            expect(
                response.body.data.preferences.email.smsAlerts,
            ).toBeUndefined();
        });
    });

    describe("given invalid preferences", () => {
        it("should return a 400 when the body is empty", async () => {
            const user = await createUser();

            const response = await updatePreferences(
                getAccessToken(user._id),
                {},
            );

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "No valid preference fields to update",
            );
        });

        it("should return a 400 when only unknown sections are sent", async () => {
            const user = await createUser();

            const response = await updatePreferences(getAccessToken(user._id), {
                sms: { dailyDigest: true },
            });

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 when a section is not an object", async () => {
            const user = await createUser();

            const response = await updatePreferences(getAccessToken(user._id), {
                email: "yes",
            });

            expect(response.statusCode).toBe(400);
        });

        it("should not change anything when the request is rejected", async () => {
            const user = await createUser();

            await updatePreferences(getAccessToken(user._id), {
                sms: { dailyDigest: true },
            });

            const updated = await User.findById(user._id);
            expect(updated.preferences.email.gameReminders).toBe(true);
        });
    });

    describe("given no or an invalid access token", () => {
        it("should return a 401 when the header is missing", async () => {
            const response = await request(app)
                .put("/user/preferences")
                .send({ email: { gameReminders: false } });

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 when the user no longer exists", async () => {
            const token = getAccessToken(new mongoose.Types.ObjectId());

            const response = await updatePreferences(token, {
                email: { gameReminders: false },
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given a soft deleted account", () => {
        it("should return a 403 status code", async () => {
            const user = await createUser({ isDeleted: true });

            const response = await updatePreferences(getAccessToken(user._id), {
                email: { gameReminders: false },
            });

            expect(response.statusCode).toBe(403);
        });
    });
});
