const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../src/app");
const Notification = require("../../src/modules/notification/notificationModel");
const { useInMemoryDatabase } = require("../utils/db");
const {
    createAdmin,
    createUser,
    getAdminToken,
    getAccessToken,
} = require("../utils/fixtures");

const validBody = {
    title: "New assessment",
    body: "A new IQ test is available",
    imageUrl: "https://cdn.bazzingo.com/banner.png",
    websiteUrl: "https://bazzingo.com/assessment",
    target: { type: "ALL" },
};

describe("POST /notifications", () => {
    useInMemoryDatabase();

    let adminToken;
    let admin;

    beforeEach(async () => {
        admin = await createAdmin();
        adminToken = getAdminToken(admin._id);
    });

    const create = (body = validBody, token = adminToken) =>
        request(app)
            .post("/notifications")
            .set("Authorization", `Bearer ${token}`)
            .send(body);

    describe("given a valid body", () => {
        it("should return a 201 status code", async () => {
            const response = await create();

            expect(response.statusCode).toBe(201);
        });

        it("should return the success envelope", async () => {
            const response = await create();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Notification created");
        });

        it("should persist every field", async () => {
            await create();

            const notification = await Notification.findOne({});
            expect(notification.title).toBe(validBody.title);
            expect(notification.body).toBe(validBody.body);
            expect(notification.imageUrl).toBe(validBody.imageUrl);
            expect(notification.websiteUrl).toBe(validBody.websiteUrl);
            expect(notification.target.type).toBe("ALL");
        });

        it("should record the admin who created it", async () => {
            await create();

            const notification = await Notification.findOne({});
            expect(String(notification.createdBy)).toBe(String(admin._id));
        });

        it("should default isActive to true", async () => {
            await create();

            const notification = await Notification.findOne({});
            expect(notification.isActive).toBe(true);
        });

        it("should omit the optional fields when they are not sent", async () => {
            const { imageUrl, websiteUrl, ...body } = validBody;

            await create(body);

            const notification = await Notification.findOne({});
            expect(notification.imageUrl).toBeUndefined();
            expect(notification.websiteUrl).toBeUndefined();
        });

        it("should accept a USER target", async () => {
            const user = await createUser();

            const response = await create({
                ...validBody,
                target: { type: "USER", userId: String(user._id) },
            });

            expect(response.statusCode).toBe(201);
            const notification = await Notification.findOne({});
            expect(String(notification.target.userId)).toBe(String(user._id));
        });

        it("should accept a CRITERIA target", async () => {
            const response = await create({
                ...validBody,
                target: {
                    type: "CRITERIA",
                    criteria: { countries: ["india"], minAge: 18, maxAge: 40 },
                },
            });

            expect(response.statusCode).toBe(201);
            const notification = await Notification.findOne({});
            expect(notification.target.criteria.minAge).toBe(18);
        });
    });

    describe("given an invalid body", () => {
        it("should return a 400 when the title is missing", async () => {
            const { title, ...body } = validBody;

            const response = await create(body);

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "title, body and target.type are required",
            );
        });

        it("should return a 400 when the body text is missing", async () => {
            const { body: text, ...rest } = validBody;

            expect((await create(rest)).statusCode).toBe(400);
        });

        it("should return a 400 when the target is missing", async () => {
            const { target, ...body } = validBody;

            expect((await create(body)).statusCode).toBe(400);
        });

        it("should return a 400 when the target type is missing", async () => {
            const response = await create({ ...validBody, target: {} });

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 for a target type outside the enum", async () => {
            const response = await create({
                ...validBody,
                target: { type: "EVERYONE" },
            });

            expect(response.statusCode).toBe(400);
        });

        it("should not persist anything when the body is rejected", async () => {
            await create({ title: "Only a title" });

            expect(await Notification.countDocuments()).toBe(0);
        });
    });

    describe("authorisation", () => {
        it("should return a 401 without a token", async () => {
            const response = await request(app)
                .post("/notifications")
                .send(validBody);

            expect(response.statusCode).toBe(401);
        });

        it("should return a 401 for a user token", async () => {
            const user = await createUser();

            const response = await create(validBody, getAccessToken(user._id));

            expect(response.statusCode).toBe(401);
        });
    });
});

describe("GET /notifications", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        const admin = await createAdmin();
        adminToken = getAdminToken(admin._id);
    });

    const addNotification = (overrides = {}) =>
        Notification.create({ ...validBody, ...overrides });

    const list = (query = "") =>
        request(app)
            .get(`/notifications${query}`)
            .set("Authorization", `Bearer ${adminToken}`);

    it("should return the success envelope", async () => {
        const response = await list();

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Notifications");
    });

    it("should default to page 1 and limit 20", async () => {
        const response = await list();

        expect(response.body.data.page).toBe(1);
        expect(response.body.data.limit).toBe(20);
    });

    it("should return the total count", async () => {
        await addNotification();
        await addNotification({ title: "Second" });

        const response = await list();

        expect(response.body.data.total).toBe(2);
        expect(response.body.data.items).toHaveLength(2);
    });

    it("should return the newest first", async () => {
        await addNotification({
            title: "Older",
            createdAt: new Date("2026-01-01"),
        });
        await addNotification({
            title: "Newer",
            createdAt: new Date("2026-02-01"),
        });

        const response = await list();

        expect(response.body.data.items[0].title).toBe("Newer");
    });

    it("should honour page and limit", async () => {
        await addNotification({
            title: "Older",
            createdAt: new Date("2026-01-01"),
        });
        await addNotification({
            title: "Newer",
            createdAt: new Date("2026-02-01"),
        });

        const response = await list("?page=2&limit=1");

        expect(response.body.data.items).toHaveLength(1);
        expect(response.body.data.items[0].title).toBe("Older");
    });

    it("should clamp the limit to 100", async () => {
        const response = await list("?limit=500");

        expect(response.body.data.limit).toBe(100);
    });

    it("should include inactive notifications", async () => {
        await addNotification({ isActive: false });

        const response = await list();

        expect(response.body.data.total).toBe(1);
    });

    it("should return a 401 for a user token", async () => {
        const user = await createUser();

        const response = await request(app)
            .get("/notifications")
            .set("Authorization", `Bearer ${getAccessToken(user._id)}`);

        expect(response.statusCode).toBe(401);
    });
});

describe("GET /notifications/:id", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        const admin = await createAdmin();
        adminToken = getAdminToken(admin._id);
    });

    const getOne = (id) =>
        request(app)
            .get(`/notifications/${id}`)
            .set("Authorization", `Bearer ${adminToken}`);

    it("should return the notification", async () => {
        const notification = await Notification.create(validBody);

        const response = await getOne(notification._id);

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Notification");
        expect(response.body.data.notification.title).toBe(validBody.title);
    });

    it("should return a 404 for an unknown id", async () => {
        const response = await getOne(new mongoose.Types.ObjectId());

        expect(response.statusCode).toBe(404);
        expect(response.body.message).toBe("Notification not found");
    });

    it("should return a 400 for a malformed id", async () => {
        const response = await getOne("not-an-id");

        expect(response.statusCode).toBe(400);
    });
});

describe("PUT /notifications/:id", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        const admin = await createAdmin();
        adminToken = getAdminToken(admin._id);
    });

    const update = (id, body) =>
        request(app)
            .put(`/notifications/${id}`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send(body);

    it("should update the allowed fields", async () => {
        const notification = await Notification.create(validBody);

        const response = await update(notification._id, {
            title: "Changed",
            isActive: false,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Notification updated");
        const updated = await Notification.findById(notification._id);
        expect(updated.title).toBe("Changed");
        expect(updated.isActive).toBe(false);
    });

    it("should ignore fields that are not allowed", async () => {
        const notification = await Notification.create(validBody);

        await update(notification._id, { pushSent: true, title: "Changed" });

        const updated = await Notification.findById(notification._id);
        expect(updated.pushSent).toBe(false);
        expect(updated.title).toBe("Changed");
    });

    it("should return a 404 for an unknown id", async () => {
        const response = await update(new mongoose.Types.ObjectId(), {
            title: "Changed",
        });

        expect(response.statusCode).toBe(404);
    });
});

describe("DELETE /notifications/:id", () => {
    useInMemoryDatabase();

    let adminToken;

    beforeEach(async () => {
        const admin = await createAdmin();
        adminToken = getAdminToken(admin._id);
    });

    const remove = (id) =>
        request(app)
            .delete(`/notifications/${id}`)
            .set("Authorization", `Bearer ${adminToken}`);

    it("should delete the notification", async () => {
        const notification = await Notification.create(validBody);

        const response = await remove(notification._id);

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe("Notification deleted");
        expect(await Notification.countDocuments()).toBe(0);
    });

    it("should return a 404 for an unknown id", async () => {
        const response = await remove(new mongoose.Types.ObjectId());

        expect(response.statusCode).toBe(404);
    });

    it("should return a 401 without a token", async () => {
        const notification = await Notification.create(validBody);

        const response = await request(app).delete(
            `/notifications/${notification._id}`,
        );

        expect(response.statusCode).toBe(401);
    });
});

describe("debug endpoints", () => {
    useInMemoryDatabase();

    it("should answer POST /notifications/minimal without a token", async () => {
        const response = await request(app)
            .post("/notifications/minimal")
            .send({ ping: true });

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("success");
        expect(response.body.message).toBe("Minimal test working");
        expect(response.body.body).toEqual({ ping: true });
    });

    it("should reject POST /notifications/debug-admin without a token", async () => {
        const response = await request(app).post("/notifications/debug-admin");

        expect(response.statusCode).toBe(401);
        expect(response.body.step).toBe("auth-header-check");
    });

    it("should answer POST /notifications/debug-admin for an admin", async () => {
        const admin = await createAdmin();

        const response = await request(app)
            .post("/notifications/debug-admin")
            .set("Authorization", `Bearer ${getAdminToken(admin._id)}`);

        expect(response.statusCode).toBe(200);
        expect(response.body.adminEmail).toBe(admin.email);
    });

    it("should answer POST /notifications/test for an admin", async () => {
        const admin = await createAdmin();

        const response = await request(app)
            .post("/notifications/test")
            .set("Authorization", `Bearer ${getAdminToken(admin._id)}`)
            .send({ ping: true });

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Test notification endpoint working",
        );
        expect(response.body.data.body).toEqual({ ping: true });
    });
});
