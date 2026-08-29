const request = require("supertest");
const app = require("../../src/app");
const PushSubscription = require("../../src/modules/push/pushSubscriptionModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser, getAccessToken } = require("../utils/fixtures");

const validSubscription = {
    endpoint: "https://push.example.com/endpoint-1",
    keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

describe("POST /push/subscribe", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const subscribe = (body, accessToken = token) =>
        request(app)
            .post("/push/subscribe")
            .set("Authorization", `Bearer ${accessToken}`)
            .send(body);

    describe("given a valid subscription", () => {
        it("should return a 200 status code", async () => {
            const response = await subscribe({
                subscription: validSubscription,
            });

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            const response = await subscribe({
                subscription: validSubscription,
            });

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe(
                "Subscribed to push notifications successfully",
            );
        });

        it("should return the stored subscription summary", async () => {
            const response = await subscribe({
                subscription: validSubscription,
            });

            expect(response.body.data.subscription.endpoint).toBe(
                validSubscription.endpoint,
            );
            expect(response.body.data.subscription.isActive).toBe(true);
            expect(response.body.data.subscription.id).toBeTruthy();
        });

        it("should never return the push keys", async () => {
            const response = await subscribe({
                subscription: validSubscription,
            });

            expect(response.body.data.subscription.keys).toBeUndefined();
        });

        it("should persist the subscription with its keys", async () => {
            await subscribe({ subscription: validSubscription });

            const doc = await PushSubscription.findOne({ userId: user._id });
            expect(doc.keys.p256dh).toBe("p256dh-key");
            expect(doc.keys.auth).toBe("auth-key");
        });

        it("should store the device id and user agent", async () => {
            await request(app)
                .post("/push/subscribe")
                .set("Authorization", `Bearer ${token}`)
                .set("User-Agent", "jest-agent")
                .send({
                    subscription: validSubscription,
                    deviceId: "device-1",
                });

            const doc = await PushSubscription.findOne({ userId: user._id });
            expect(doc.deviceId).toBe("device-1");
            expect(doc.userAgent).toBe("jest-agent");
        });

        it("should update the existing subscription for the same endpoint", async () => {
            await subscribe({ subscription: validSubscription });

            await subscribe({
                subscription: {
                    ...validSubscription,
                    keys: { p256dh: "new-p256dh", auth: "new-auth" },
                },
            });

            expect(
                await PushSubscription.countDocuments({ userId: user._id }),
            ).toBe(1);
            const doc = await PushSubscription.findOne({ userId: user._id });
            expect(doc.keys.p256dh).toBe("new-p256dh");
        });

        it("should keep separate subscriptions per endpoint", async () => {
            await subscribe({ subscription: validSubscription });

            await subscribe({
                subscription: {
                    ...validSubscription,
                    endpoint: "https://push.example.com/endpoint-2",
                },
            });

            expect(
                await PushSubscription.countDocuments({ userId: user._id }),
            ).toBe(2);
        });

        it("should reactivate a previously unsubscribed endpoint", async () => {
            await subscribe({ subscription: validSubscription });
            await request(app)
                .post("/push/unsubscribe")
                .set("Authorization", `Bearer ${token}`)
                .send({ endpoint: validSubscription.endpoint });

            await subscribe({ subscription: validSubscription });

            const doc = await PushSubscription.findOne({ userId: user._id });
            expect(doc.isActive).toBe(true);
        });
    });

    describe("given an invalid subscription", () => {
        it("should return a 400 when the subscription is missing", async () => {
            const response = await subscribe({});

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Invalid subscription payload");
        });

        it("should return a 400 when the endpoint is missing", async () => {
            const response = await subscribe({
                subscription: { keys: validSubscription.keys },
            });

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 when the keys are missing", async () => {
            const response = await subscribe({
                subscription: { endpoint: validSubscription.endpoint },
            });

            expect(response.statusCode).toBe(400);
        });

        it("should not persist anything when the payload is rejected", async () => {
            await subscribe({});

            expect(await PushSubscription.countDocuments()).toBe(0);
        });

        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post("/push/subscribe")
                .send({ subscription: validSubscription });

            expect(response.statusCode).toBe(401);
        });
    });
});

describe("POST /push/unsubscribe", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const unsubscribe = (body) =>
        request(app)
            .post("/push/unsubscribe")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    const addSubscription = () =>
        PushSubscription.create({
            userId: user._id,
            endpoint: validSubscription.endpoint,
            keys: validSubscription.keys,
        });

    it("should return a 200 status code", async () => {
        await addSubscription();

        const response = await unsubscribe({
            endpoint: validSubscription.endpoint,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Unsubscribed");
    });

    it("should deactivate the subscription without deleting it", async () => {
        await addSubscription();

        await unsubscribe({ endpoint: validSubscription.endpoint });

        const doc = await PushSubscription.findOne({ userId: user._id });
        expect(doc).not.toBeNull();
        expect(doc.isActive).toBe(false);
    });

    it("should return a 200 for an endpoint that is not subscribed", async () => {
        const response = await unsubscribe({
            endpoint: "https://push.example.com/unknown",
        });

        expect(response.statusCode).toBe(200);
    });

    it("should not deactivate another user's subscription", async () => {
        const other = await createUser({ email: "other@bazzingo.com" });
        await PushSubscription.create({
            userId: other._id,
            endpoint: validSubscription.endpoint,
            keys: validSubscription.keys,
        });

        await unsubscribe({ endpoint: validSubscription.endpoint });

        const doc = await PushSubscription.findOne({ userId: other._id });
        expect(doc.isActive).toBe(true);
    });

    it("should return a 400 when the endpoint is missing", async () => {
        const response = await unsubscribe({});

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe("endpoint is required");
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app)
            .post("/push/unsubscribe")
            .send({ endpoint: validSubscription.endpoint });

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /push/status", () => {
    useInMemoryDatabase();

    let user;
    let token;

    beforeEach(async () => {
        user = await createUser();
        token = getAccessToken(user._id);
    });

    const getStatus = () =>
        request(app)
            .get("/push/status")
            .set("Authorization", `Bearer ${token}`);

    const addSubscription = (overrides = {}) =>
        PushSubscription.create({
            userId: user._id,
            endpoint: validSubscription.endpoint,
            keys: validSubscription.keys,
            ...overrides,
        });

    it("should report no subscription when there is none", async () => {
        const response = await getStatus();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("No active push subscription found");
        expect(response.body.data.isSubscribed).toBe(false);
        expect(response.body.data.subscription).toBeNull();
    });

    it("should report an active subscription", async () => {
        await addSubscription();

        const response = await getStatus();

        expect(response.body.message).toBe("Push subscription found");
        expect(response.body.data.isSubscribed).toBe(true);
        expect(response.body.data.subscription.endpoint).toBe(
            validSubscription.endpoint,
        );
    });

    it("should report hasKeys without exposing the keys", async () => {
        await addSubscription();

        const response = await getStatus();

        expect(response.body.data.subscription.hasKeys).toBe(true);
        expect(response.body.data.subscription.keys).toBeUndefined();
    });

    it("should ignore an inactive subscription", async () => {
        await addSubscription({ isActive: false });

        const response = await getStatus();

        expect(response.body.data.isSubscribed).toBe(false);
    });

    it("should ignore another user's subscription", async () => {
        const other = await createUser({ email: "other@bazzingo.com" });
        await PushSubscription.create({
            userId: other._id,
            endpoint: validSubscription.endpoint,
            keys: validSubscription.keys,
        });

        const response = await getStatus();

        expect(response.body.data.isSubscribed).toBe(false);
    });

    it("should return a 401 without a token", async () => {
        const response = await request(app).get("/push/status");

        expect(response.statusCode).toBe(401);
    });
});
