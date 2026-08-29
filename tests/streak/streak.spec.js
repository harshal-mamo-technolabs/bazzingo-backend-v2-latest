const request = require("supertest");
const app = require("../../src/app");
const UserDailyActivity = require("../../src/modules/streak/userDailyActivityModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

const startOfDay = (dateLike) => {
    const date = dateLike ? new Date(dateLike) : new Date();
    date.setHours(0, 0, 0, 0);
    return date;
};

const daysAgo = (days) => {
    const date = startOfDay(new Date());
    date.setDate(date.getDate() - days);
    return date;
};

describe("POST /streak", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const upsert = (body, accessToken = token) =>
        request(app)
            .post("/streak")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    describe("given at least one boolean flag", () => {
        it("should return a 200 status code", async () => {
            const response = await upsert({ isGamePlayed: true });

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            const response = await upsert({ isGamePlayed: true });

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Daily activity saved");
        });

        it("should return the saved activity", async () => {
            const response = await upsert({ isGamePlayed: true });

            expect(response.body.data.userDailyActivity.isGamePlayed).toBe(
                true,
            );
        });

        it("should persist the game flag", async () => {
            await upsert({ isGamePlayed: true });

            const activity = await UserDailyActivity.findOne({
                userId: user._id,
            });
            expect(activity.isGamePlayed).toBe(true);
        });

        it("should persist the assessment flag", async () => {
            await upsert({ isAssessmentCompleted: true });

            const activity = await UserDailyActivity.findOne({
                userId: user._id,
            });
            expect(activity.isAssessmentCompleted).toBe(true);
        });

        it("should persist both flags together", async () => {
            await upsert({ isGamePlayed: true, isAssessmentCompleted: true });

            const activity = await UserDailyActivity.findOne({
                userId: user._id,
            });
            expect(activity.isGamePlayed).toBe(true);
            expect(activity.isAssessmentCompleted).toBe(true);
        });

        it("should accept false as a valid flag", async () => {
            await upsert({ isGamePlayed: true });

            const response = await upsert({ isGamePlayed: false });

            expect(response.statusCode).toBe(200);
            const activity = await UserDailyActivity.findOne({
                userId: user._id,
            });
            expect(activity.isGamePlayed).toBe(false);
        });

        it("should update the existing row rather than adding one", async () => {
            await upsert({ isGamePlayed: true });
            await upsert({ isAssessmentCompleted: true });

            expect(
                await UserDailyActivity.countDocuments({ userId: user._id }),
            ).toBe(1);
        });

        it("should not touch another user's activity", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await UserDailyActivity.create({
                userId: other._id,
                date: startOfDay(new Date()),
                isGamePlayed: false,
            });

            await upsert({ isGamePlayed: true });

            const otherActivity = await UserDailyActivity.findOne({
                userId: other._id,
            });
            expect(otherActivity.isGamePlayed).toBe(false);
        });
    });

    describe("given no usable flag", () => {
        it("should return a 400 when the body is empty", async () => {
            const response = await upsert({});

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Provide at least one of isGamePlayed or isAssessmentCompleted",
            );
        });

        it("should return a 400 when the flags are not booleans", async () => {
            const response = await upsert({
                isGamePlayed: "yes",
                isAssessmentCompleted: 1,
            });

            expect(response.statusCode).toBe(400);
        });

        it("should not persist anything when the body is rejected", async () => {
            await upsert({});

            expect(await UserDailyActivity.countDocuments()).toBe(0);
        });

        it("should return a 401 without a token", async () => {
            const response = await request(app).post("/streak").send({});

            expect(response.statusCode).toBe(401);
        });
    });
});

describe("GET /streak", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const addActivity = async (createdAt, flags = { isGamePlayed: true }) =>
        await UserDailyActivity.create({
            userId: user._id,
            date: createdAt,
            createdAt,
            ...flags,
        });

    const getStreak = (query = "") =>
        request(app)
            .get(`/streak${query}`)
            .set("Authorization", `Bearer ${token}`);

    describe("with the default range", () => {
        it("should return a 200 status code", async () => {
            const response = await getStreak();

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            const response = await getStreak();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Streak data");
        });

        it("should return zero streaks when there is no activity", async () => {
            const response = await getStreak();

            expect(response.body.data.stats).toEqual({
                currentStreak: 0,
                longestStreak: 0,
            });
            expect(response.body.data.days).toEqual([]);
        });

        it("should count a single active day as a streak of one", async () => {
            await addActivity(new Date());

            const response = await getStreak();

            expect(response.body.data.stats.currentStreak).toBe(1);
            expect(response.body.data.stats.longestStreak).toBe(1);
        });

        it("should count consecutive days up to today as the current streak", async () => {
            await addActivity(daysAgo(2));
            await addActivity(daysAgo(1));
            await addActivity(daysAgo(0));

            const response = await getStreak();

            expect(response.body.data.stats.currentStreak).toBe(3);
        });

        it("should break the current streak on a missing day", async () => {
            await addActivity(daysAgo(3));
            await addActivity(daysAgo(2));

            const response = await getStreak();

            expect(response.body.data.stats.currentStreak).toBe(0);
        });

        it("should keep the longest streak across gaps", async () => {
            await addActivity(daysAgo(10));
            await addActivity(daysAgo(9));
            await addActivity(daysAgo(8));
            await addActivity(daysAgo(0));

            const response = await getStreak();

            expect(response.body.data.stats.longestStreak).toBe(3);
            expect(response.body.data.stats.currentStreak).toBe(1);
        });

        it("should count an assessment day as active", async () => {
            await addActivity(new Date(), {
                isGamePlayed: false,
                isAssessmentCompleted: true,
            });

            const response = await getStreak();

            expect(response.body.data.stats.currentStreak).toBe(1);
        });

        it("should ignore a day with no activity flag", async () => {
            await addActivity(new Date(), {
                isGamePlayed: false,
                isAssessmentCompleted: false,
            });

            const response = await getStreak();

            expect(response.body.data.days).toEqual([]);
            expect(response.body.data.stats.currentStreak).toBe(0);
        });

        it("should not count another user's activity", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await UserDailyActivity.create({
                userId: other._id,
                date: new Date(),
                isGamePlayed: true,
            });

            const response = await getStreak();

            expect(response.body.data.stats.currentStreak).toBe(0);
        });

        it("should return the range it used", async () => {
            const response = await getStreak();

            expect(response.body.data.range.start).toBeTruthy();
            expect(response.body.data.range.end).toBeTruthy();
        });
    });

    describe("with an explicit range", () => {
        it("should accept a start and end date", async () => {
            await addActivity(new Date("2026-05-10T10:00:00Z"));

            const response = await getStreak(
                "?startDate=2026-05-01&endDate=2026-05-31",
            );

            expect(response.statusCode).toBe(200);
            expect(response.body.data.days).toHaveLength(1);
        });

        it("should exclude activity outside the range", async () => {
            await addActivity(new Date("2026-04-10T10:00:00Z"));

            const response = await getStreak(
                "?startDate=2026-05-01&endDate=2026-05-31",
            );

            expect(response.body.data.days).toEqual([]);
        });

        it("should swap a reversed range", async () => {
            await addActivity(new Date("2026-05-10T10:00:00Z"));

            const response = await getStreak(
                "?startDate=2026-05-31&endDate=2026-05-01",
            );

            expect(response.statusCode).toBe(200);
            expect(response.body.data.days).toHaveLength(1);
        });

        it("should return a 400 with status fail when only startDate is sent", async () => {
            const response = await getStreak("?startDate=2026-05-01");

            expect(response.statusCode).toBe(400);
            expect(response.body.status).toBe("fail");
            expect(response.body.message).toBe(
                "Both startDate and endDate are required when filtering by date range.",
            );
        });

        it("should return a 400 with status fail when only endDate is sent", async () => {
            const response = await getStreak("?endDate=2026-05-31");

            expect(response.statusCode).toBe(400);
            expect(response.body.status).toBe("fail");
        });

        it("should return a 400 for an unparsable date", async () => {
            const response = await getStreak(
                "?startDate=not-a-date&endDate=2026-05-31",
            );

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Invalid startDate or endDate. Use an ISO date string (e.g., 2025-08-24).",
            );
        });
    });

    describe("authentication", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app).get("/streak");

            expect(response.statusCode).toBe(401);
        });
    });
});
