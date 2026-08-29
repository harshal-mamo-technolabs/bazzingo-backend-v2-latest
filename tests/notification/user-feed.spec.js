const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../src/app");
const Notification = require("../../src/modules/notification/notificationModel");
const NotificationReceipt = require("../../src/modules/notification/notificationReceiptModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

describe("GET /notifications/my-notifications", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser({ age: 27, country: "india" });
        token = getAccessToken(user._id);
    });

    const addNotification = (overrides = {}) =>
        Notification.create({
            title: "Notice",
            body: "Body",
            target: { type: "ALL" },
            ...overrides,
        });

    const fetchMine = (query = "") =>
        request(app)
            .get(`/notifications/my-notifications${query}`)
            .set("Authorization", `Bearer ${token}`);

    describe("eligibility", () => {
        it("should return the success envelope", async () => {
            const response = await fetchMine();

            expect(response.statusCode).toBe(200);
            expect(response.body.message).toBe("Notifications");
        });

        it("should include an ALL notification", async () => {
            await addNotification();

            const response = await fetchMine();

            expect(response.body.data.items).toHaveLength(1);
        });

        it("should exclude an inactive notification", async () => {
            await addNotification({ isActive: false });

            const response = await fetchMine();

            expect(response.body.data.items).toEqual([]);
        });

        it("should include a USER notification addressed to the caller", async () => {
            await addNotification({
                target: { type: "USER", userId: user._id },
            });

            const response = await fetchMine();

            expect(response.body.data.items).toHaveLength(1);
        });

        it("should exclude a USER notification for someone else", async () => {
            const other = await createUser({ email: "other@bazzingo.com" });
            await addNotification({
                target: { type: "USER", userId: other._id },
            });

            const response = await fetchMine();

            expect(response.body.data.items).toEqual([]);
        });

        it("should include a CRITERIA notification matching the country", async () => {
            await addNotification({
                target: {
                    type: "CRITERIA",
                    criteria: { countries: ["india"] },
                },
            });

            const response = await fetchMine();

            expect(response.body.data.items).toHaveLength(1);
        });

        it("should exclude a CRITERIA notification for another country", async () => {
            await addNotification({
                target: {
                    type: "CRITERIA",
                    criteria: { countries: ["germany"] },
                },
            });

            const response = await fetchMine();

            expect(response.body.data.items).toEqual([]);
        });

        it("should include a CRITERIA notification with an empty country list", async () => {
            await addNotification({
                target: { type: "CRITERIA", criteria: { countries: [] } },
            });

            const response = await fetchMine();

            expect(response.body.data.items).toHaveLength(1);
        });

        it("should respect the minimum age", async () => {
            await addNotification({
                target: {
                    type: "CRITERIA",
                    criteria: { countries: [], minAge: 30 },
                },
            });

            const response = await fetchMine();

            expect(response.body.data.items).toEqual([]);
        });

        it("should respect the maximum age", async () => {
            await addNotification({
                target: {
                    type: "CRITERIA",
                    criteria: { countries: [], maxAge: 20 },
                },
            });

            const response = await fetchMine();

            expect(response.body.data.items).toEqual([]);
        });

        it("should include a notification inside the age band", async () => {
            await addNotification({
                target: {
                    type: "CRITERIA",
                    criteria: { countries: [], minAge: 20, maxAge: 30 },
                },
            });

            const response = await fetchMine();

            expect(response.body.data.items).toHaveLength(1);
        });
    });

    describe("read state", () => {
        it("should count every eligible notification as unread by default", async () => {
            await addNotification();
            await addNotification({ title: "Second" });

            const response = await fetchMine();

            expect(response.body.data.unreadCount).toBe(2);
            expect(response.body.data.total).toBe(2);
        });

        it("should not count a read notification as unread", async () => {
            const notification = await addNotification();
            await NotificationReceipt.create({
                userId: user._id,
                notificationId: notification._id,
                isRead: true,
            });

            const response = await fetchMine();

            expect(response.body.data.unreadCount).toBe(0);
            expect(response.body.data.total).toBe(1);
        });

        it("should put unread notifications before read ones", async () => {
            const readOne = await addNotification({
                title: "Read",
                createdAt: new Date("2026-02-01"),
            });
            await addNotification({
                title: "Unread",
                createdAt: new Date("2026-01-01"),
            });
            await NotificationReceipt.create({
                userId: user._id,
                notificationId: readOne._id,
                isRead: true,
            });

            const response = await fetchMine();

            expect(response.body.data.items.map((i) => i.title)).toEqual([
                "Unread",
                "Read",
            ]);
        });

        it("should ignore another user's receipt", async () => {
            const notification = await addNotification();
            const other = await createUser({ email: "other@bazzingo.com" });
            await NotificationReceipt.create({
                userId: other._id,
                notificationId: notification._id,
                isRead: true,
            });

            const response = await fetchMine();

            expect(response.body.data.unreadCount).toBe(1);
        });
    });

    describe("pagination", () => {
        it("should default to page 1 and limit 20", async () => {
            const response = await fetchMine();

            expect(response.body.data.page).toBe(1);
            expect(response.body.data.limit).toBe(20);
        });

        it("should cap the limit at 20", async () => {
            const response = await fetchMine("?limit=100");

            expect(response.body.data.limit).toBe(20);
        });

        it("should honour the page", async () => {
            await addNotification({
                title: "First",
                createdAt: new Date("2026-02-01"),
            });
            await addNotification({
                title: "Second",
                createdAt: new Date("2026-01-01"),
            });

            const response = await fetchMine("?page=2&limit=1");

            expect(response.body.data.items.map((i) => i.title)).toEqual([
                "Second",
            ]);
        });
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get(
            "/notifications/my-notifications",
        );

        expect(response.statusCode).toBe(401);
    });
});

describe("POST /notifications/:id/acknowledge", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const addNotification = () =>
        Notification.create({
            title: "Notice",
            body: "Body",
            target: { type: "ALL" },
        });

    const acknowledge = (id) =>
        request(app)
            .post(`/notifications/${id}/acknowledge`)
            .set("Authorization", `Bearer ${token}`);

    it("should return the success envelope", async () => {
        const notification = await addNotification();

        const response = await acknowledge(notification._id);

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Notification marked as read");
    });

    it("should create the receipt", async () => {
        const notification = await addNotification();

        await acknowledge(notification._id);

        const receipt = await NotificationReceipt.findOne({
            userId: user._id,
            notificationId: notification._id,
        });
        expect(receipt.isRead).toBe(true);
        expect(receipt.readAt).toBeInstanceOf(Date);
    });

    it("should be idempotent", async () => {
        const notification = await addNotification();

        await acknowledge(notification._id);
        await acknowledge(notification._id);

        expect(
            await NotificationReceipt.countDocuments({ userId: user._id }),
        ).toBe(1);
    });

    it("should return a 404 for an unknown notification", async () => {
        const response = await acknowledge(new mongoose.Types.ObjectId());

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Notification not found");
    });

    it("should not create a receipt for an unknown notification", async () => {
        await acknowledge(new mongoose.Types.ObjectId());

        expect(await NotificationReceipt.countDocuments()).toBe(0);
    });

    it("should return a 401 without a token", async () => {
        const notification = await addNotification();

        const response = await request(app).post(
            `/notifications/${notification._id}/acknowledge`,
        );

        expect(response.statusCode).toBe(401);
    });
});
