const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../src/app");
const User = require("../../src/modules/user/userModel");
const Leaderboard = require("../../src/modules/leaderboard/leaderboardModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

describe("PUT /user", () => {
    useInMemoryDatabase();

    const updateProfile = (token, body) =>
        request(app)
            .put("/user")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    describe("given valid fields", () => {
        it("should return a 200 status code", async () => {
            const user = await createUser();

            const response = await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
            });

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            const user = await createUser();

            const response = await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
            });

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("User updated");
        });

        it("should persist every allowed field", async () => {
            const user = await createUser();

            await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
                avatar: "avatar-9.png",
                age: 31,
                country: "Germany",
            });

            const updated = await User.findById(user._id);
            expect(updated.name).toBe("Harshal Chauhan");
            expect(updated.avatar).toBe("avatar-9.png");
            expect(updated.age).toBe(31);
            expect(updated.country).toBe("Germany");
        });

        it("should return the updated user without the password", async () => {
            const user = await createUser();

            const response = await updateProfile(getAccessToken(user._id), {
                country: "Germany",
            });

            expect(response.body.data.user.country).toBe("Germany");
            expect(response.body.data.user.password).toBeUndefined();
        });

        it("should ignore fields that are not allowed", async () => {
            const user = await createUser();

            await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
                email: "attacker@bazzingo.com",
                iq: 199,
                isDeleted: true,
            });

            const updated = await User.findById(user._id);
            expect(updated.email).toBe("harshal@bazzingo.com");
            expect(updated.iq).toBe(0);
            expect(updated.isDeleted).toBe(false);
        });

        it("should update only the fields that were sent", async () => {
            const user = await createUser();

            await updateProfile(getAccessToken(user._id), { age: 31 });

            const updated = await User.findById(user._id);
            expect(updated.age).toBe(31);
            expect(updated.name).toBe("Harshal");
            expect(updated.country).toBe("India");
        });
    });

    describe("leaderboard sync", () => {
        it("should create the leaderboard row on the first profile edit", async () => {
            const user = await createUser();

            await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
            });

            const row = await Leaderboard.findOne({ userId: user._id });
            expect(row).not.toBeNull();
            expect(row.name).toBe("Harshal Chauhan");
        });

        it("should mirror every synced field", async () => {
            const user = await createUser();

            await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
                avatar: "avatar-9.png",
                age: 31,
                country: "Germany",
            });

            const row = await Leaderboard.findOne({ userId: user._id });
            expect(row.name).toBe("Harshal Chauhan");
            expect(row.avatar).toBe("avatar-9.png");
            expect(row.country).toBe("germany");
            expect(row.ageGroup).toBe("25-34");
        });

        it("should fall back to the stored value for fields not sent", async () => {
            const user = await createUser();

            await updateProfile(getAccessToken(user._id), { age: 31 });

            const row = await Leaderboard.findOne({ userId: user._id });
            expect(row.name).toBe("Harshal");
            expect(row.country).toBe("india");
        });

        it("should update the existing row instead of adding one", async () => {
            const user = await createUser();
            await updateProfile(getAccessToken(user._id), { name: "First" });

            await updateProfile(getAccessToken(user._id), { name: "Second" });

            expect(await Leaderboard.countDocuments({ userId: user._id })).toBe(
                1,
            );
            const row = await Leaderboard.findOne({ userId: user._id });
            expect(row.name).toBe("Second");
        });

        it("should still return 200 when the leaderboard sync fails", async () => {
            const user = await createUser();
            const spy = jest.spyOn(Leaderboard, "findOne").mockReturnValueOnce({
                lean: () => Promise.reject(new Error("leaderboard is down")),
            });

            const response = await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
            });

            expect(response.statusCode).toBe(200);
            spy.mockRestore();
        });

        it("should still persist the profile when the leaderboard sync fails", async () => {
            const user = await createUser();
            const spy = jest.spyOn(Leaderboard, "findOne").mockReturnValueOnce({
                lean: () => Promise.reject(new Error("leaderboard is down")),
            });

            await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
            });

            const updated = await User.findById(user._id);
            expect(updated.name).toBe("Harshal Chauhan");
            spy.mockRestore();
        });
    });

    describe("given invalid fields", () => {
        it("should return a 400 when the body is empty", async () => {
            const user = await createUser();

            const response = await updateProfile(getAccessToken(user._id), {});

            expect(response.statusCode).toBe(400);
            expect(response.body.status).toBe("error");
        });

        it("should return a 400 when no allowed field is sent", async () => {
            const user = await createUser();

            const response = await updateProfile(getAccessToken(user._id), {
                email: "attacker@bazzingo.com",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("No valid fields to update");
        });

        it("should return a 400 when the name is empty", async () => {
            const user = await createUser();

            const response = await updateProfile(getAccessToken(user._id), {
                name: "  ",
            });

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 when the age is not a number", async () => {
            const user = await createUser();

            const response = await updateProfile(getAccessToken(user._id), {
                age: "twenty",
            });

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 when the age is out of range", async () => {
            const user = await createUser();

            const response = await updateProfile(getAccessToken(user._id), {
                age: 250,
            });

            expect(response.statusCode).toBe(400);
        });

        it("should not persist anything when validation fails", async () => {
            const user = await createUser();

            await updateProfile(getAccessToken(user._id), { age: 250 });

            const updated = await User.findById(user._id);
            expect(updated.age).toBe(27);
        });
    });

    describe("given no or an invalid access token", () => {
        it("should return a 401 when the header is missing", async () => {
            const response = await request(app).put("/user").send({
                name: "Harshal Chauhan",
            });

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 when the user no longer exists", async () => {
            const token = getAccessToken(new mongoose.Types.ObjectId());

            const response = await updateProfile(token, {
                name: "Harshal Chauhan",
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe("given a soft deleted account", () => {
        it("should return a 403 status code", async () => {
            const user = await createUser({ isDeleted: true });

            const response = await updateProfile(getAccessToken(user._id), {
                name: "Harshal Chauhan",
            });

            expect(response.statusCode).toBe(403);
        });
    });
});
