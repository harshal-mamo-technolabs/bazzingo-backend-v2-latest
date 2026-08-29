const logger = require("../../src/config/logger");
const Notification = require("../../src/modules/notification/notificationModel");
const PushSubscription = require("../../src/modules/push/pushSubscriptionModel");
const {
    NotificationService,
} = require("../../src/modules/notification/notificationService");
const { PushService } = require("../../src/modules/push/pushService");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");

describe("NotificationService.dispatchPush", () => {
    useInMemoryDatabase();

    let service;
    let sent;
    let sendWebPush;

    beforeEach(() => {
        sent = [];
        sendWebPush = jest.fn(async (subscription, payload) => {
            sent.push({ subscription, payload });
            return { ok: true };
        });

        service = new NotificationService(
            logger,
            new PushService(logger),
            sendWebPush,
        );
    });

    const addSubscription = (user, overrides = {}) =>
        PushSubscription.create({
            userId: user._id,
            endpoint: `https://push.example.com/${user._id}`,
            keys: { p256dh: "p256dh", auth: "auth" },
            ...overrides,
        });

    const addNotification = (target) =>
        Notification.create({
            title: "Notice",
            body: "Body",
            target,
        });

    describe("recipient resolution", () => {
        it("should push to every user for an ALL target", async () => {
            const first = await createUser();
            const second = await createUser({ email: "second@bazzingo.com" });
            await addSubscription(first);
            await addSubscription(second);
            const notification = await addNotification({ type: "ALL" });

            await service.dispatchPush(notification);

            expect(sendWebPush).toHaveBeenCalledTimes(2);
        });

        it("should never push to a soft deleted account", async () => {
            const live = await createUser();
            const deleted = await createUser({
                email: "deleted@bazzingo.com",
                isDeleted: true,
            });
            await addSubscription(live);
            await addSubscription(deleted);
            const notification = await addNotification({ type: "ALL" });

            await service.dispatchPush(notification);

            expect(sendWebPush).toHaveBeenCalledTimes(1);
        });

        it("should push only to the addressed user for a USER target", async () => {
            const target = await createUser();
            const other = await createUser({ email: "other@bazzingo.com" });
            await addSubscription(target);
            await addSubscription(other);
            const notification = await addNotification({
                type: "USER",
                userId: target._id,
            });

            await service.dispatchPush(notification);

            expect(sendWebPush).toHaveBeenCalledTimes(1);
            expect(sent[0].subscription.endpoint).toContain(String(target._id));
        });

        it("should filter by country for a CRITERIA target", async () => {
            const indian = await createUser({ country: "india" });
            const german = await createUser({
                email: "german@bazzingo.com",
                country: "germany",
            });
            await addSubscription(indian);
            await addSubscription(german);
            const notification = await addNotification({
                type: "CRITERIA",
                criteria: { countries: ["india"] },
            });

            await service.dispatchPush(notification);

            expect(sendWebPush).toHaveBeenCalledTimes(1);
        });

        it("should filter by the age band for a CRITERIA target", async () => {
            const young = await createUser({ age: 18 });
            const old = await createUser({
                email: "old@bazzingo.com",
                age: 60,
            });
            await addSubscription(young);
            await addSubscription(old);
            const notification = await addNotification({
                type: "CRITERIA",
                criteria: { minAge: 50, maxAge: 70 },
            });

            await service.dispatchPush(notification);

            expect(sendWebPush).toHaveBeenCalledTimes(1);
            expect(sent[0].subscription.endpoint).toContain(String(old._id));
        });

        it("should skip inactive subscriptions", async () => {
            const user = await createUser();
            await addSubscription(user, { isActive: false });
            const notification = await addNotification({ type: "ALL" });

            await service.dispatchPush(notification);

            expect(sendWebPush).not.toHaveBeenCalled();
        });
    });

    describe("payload", () => {
        it("should carry the notification content", async () => {
            const user = await createUser();
            await addSubscription(user);
            const notification = await Notification.create({
                title: "Title",
                body: "Body",
                imageUrl: "image.png",
                websiteUrl: "https://bazzingo.com",
                target: { type: "ALL" },
            });

            await service.dispatchPush(notification);

            expect(sent[0].payload).toEqual({
                title: "Title",
                body: "Body",
                imageUrl: "image.png",
                websiteUrl: "https://bazzingo.com",
                notificationId: notification._id,
            });
        });
    });

    describe("bookkeeping", () => {
        it("should mark the notification as push sent", async () => {
            const user = await createUser();
            await addSubscription(user);
            const notification = await addNotification({ type: "ALL" });

            await service.dispatchPush(notification);

            const updated = await Notification.findById(notification._id);
            expect(updated.pushSent).toBe(true);
        });

        it("should mark it as push sent even with no recipients", async () => {
            const notification = await addNotification({ type: "ALL" });

            await service.dispatchPush(notification);

            const updated = await Notification.findById(notification._id);
            expect(updated.pushSent).toBe(true);
        });

        it("should not dispatch twice", async () => {
            const user = await createUser();
            await addSubscription(user);
            const notification = await addNotification({ type: "ALL" });
            await service.dispatchPush(notification);

            await service.dispatchPush(
                await Notification.findById(notification._id),
            );

            expect(sendWebPush).toHaveBeenCalledTimes(1);
        });

        it("should deactivate a subscription the push service rejects", async () => {
            const user = await createUser();
            await addSubscription(user);
            sendWebPush.mockResolvedValueOnce({ ok: false, remove: true });
            const notification = await addNotification({ type: "ALL" });

            await service.dispatchPush(notification);

            const subscription = await PushSubscription.findOne({
                userId: user._id,
            });
            expect(subscription.isActive).toBe(false);
        });

        it("should keep a subscription that failed for another reason", async () => {
            const user = await createUser();
            await addSubscription(user);
            sendWebPush.mockResolvedValueOnce({
                ok: false,
                error: new Error("timeout"),
            });
            const notification = await addNotification({ type: "ALL" });

            await service.dispatchPush(notification);

            const subscription = await PushSubscription.findOne({
                userId: user._id,
            });
            expect(subscription.isActive).toBe(true);
        });

        it("should not throw when a push rejects", async () => {
            const user = await createUser();
            await addSubscription(user);
            sendWebPush.mockRejectedValueOnce(new Error("push exploded"));
            const notification = await addNotification({ type: "ALL" });

            await expect(
                service.dispatchPush(notification),
            ).resolves.not.toThrow();
        });
    });
});
