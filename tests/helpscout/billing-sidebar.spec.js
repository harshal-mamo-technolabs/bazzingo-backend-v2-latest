const { StripeService } = require("../../src/modules/stripe/stripeService");
const request = require("supertest");
const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { config } = require("../../src/config");
const Subscription = require("../../src/modules/stripe/subscriptionModel");
const { useInMemoryDatabase } = require("../utils/db");
const { createUser } = require("../utils/fixtures");
const {
    BillingSidebarService,
} = require("../../src/modules/helpscout/billingSidebarService");
const {
    KlaviyoSyncService,
} = require("../../src/modules/lp/klaviyoSyncService");
const mockStripe = {
    subscriptions: {
        retrieve: jest.fn(),
        update: jest.fn(),
        cancel: jest.fn(),
    },
};
jest.mock("../../src/config/stripe", () => ({ getStripe: () => mockStripe }));
const router = require("../../src/modules/helpscout/helpscoutRouter");
const app = express();
app.use(express.json());
app.use("/helpscout", router);
const KEY = "billing-test-secret";
const PREFIX = "/helpscout/billing-sidebar";
function signed(params = { "user-id": "7" }) {
    const signature = crypto
        .createHmac("sha1", KEY)
        .update(JSON.stringify(params))
        .digest("base64");
    return `${PREFIX}?${new URLSearchParams({ ...params, "X-HelpScout-Signature": signature })}`;
}
function contextToken(html) {
    const value = /data-token="([^"]+)"/.exec(html)?.[1];
    if (!value) throw new Error("Missing context token");
    return value;
}
function sessionToken(html) {
    const value = /name="token" value="([^"]+)"/.exec(html)?.[1];
    if (!value) throw new Error("Missing session token");
    return value;
}

describe("Bazzingo Help Scout subscription sidebar", () => {
    useInMemoryDatabase();
    let user, email, inboxId, originalConfig;
    beforeEach(async () => {
        jest.clearAllMocks();
        originalConfig = [
            config.HELP_SCOUT_BILLING_SECRET,
            config.HELP_SCOUT_BILLING_INBOX_ID,
        ];
        config.HELP_SCOUT_BILLING_SECRET = KEY;
        config.HELP_SCOUT_BILLING_INBOX_ID = "365852";
        user = await createUser();
        email = user.email;
        inboxId = 365852;
        await Subscription.create({
            userId: user._id,
            stripeSubscriptionId: "sub_sidebar",
            status: "active",
            planDuration: "monthly",
            currentPeriodStart: new Date("2026-11-01"),
            currentPeriodEnd: new Date("2026-12-01"),
        });
        jest.spyOn(BillingSidebarService.prototype, "read").mockImplementation(
            async (path) => {
                if (path.startsWith("/users?"))
                    return {
                        _embedded: {
                            users: [{ id: 7, role: "user", type: "user" }],
                        },
                    };
                if (path.startsWith("/customers/"))
                    return {
                        id: 42,
                        _embedded: { emails: [{ value: email }] },
                    };
                return {
                    id: 123,
                    mailboxId: inboxId,
                    primaryCustomer: { email },
                };
            },
        );
        jest.spyOn(
            KlaviyoSyncService.prototype,
            "syncSubscription",
        ).mockResolvedValue({ skipped: true });
        mockStripe.subscriptions.retrieve.mockResolvedValue({
            id: "sub_sidebar",
            metadata: { existing: "value" },
        });
        mockStripe.subscriptions.update.mockResolvedValue({
            id: "sub_sidebar",
            status: "active",
            current_period_end: 1893456000,
            metadata: {},
        });
    });
    afterEach(() => {
        jest.restoreAllMocks();
        [config.HELP_SCOUT_BILLING_SECRET, config.HELP_SCOUT_BILLING_INBOX_ID] =
            originalConfig;
    });
    async function load(reference = { customerId: "42" }) {
        const boot = await request(app).get(signed());
        expect(boot.status).toBe(200);
        return request(app)
            .post(`${PREFIX}/context`)
            .send({ token: contextToken(boot.text), ...reference });
    }
    const cancelBody = (html) => ({
        token: sessionToken(html),
        reason: "Too expensive.",
        wouldHaveStayedIfOffered: ["Lower-cost subscription"],
        confirmed: "yes",
    });

    it("rejects unsigned, tampered and duplicate signed callbacks", async () => {
        expect((await request(app).get(PREFIX)).status).toBe(401);
        expect(
            (await request(app).get(signed().replace("user-id=7", "user-id=8")))
                .status,
        ).toBe(401);
        expect((await request(app).get(`${signed()}&user-id=8`)).status).toBe(
            401,
        );
    });
    it("does not accept the public profile-app token for cancellation", async () => {
        expect(
            (
                await request(app)
                    .post(`${PREFIX}/cancel`)
                    .set(
                        "Authorization",
                        `Bearer ${config.HELP_SCOUT_APP_SECRET}`,
                    )
                    .send({ confirmed: "yes" })
            ).status,
        ).toBe(401);
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
    it("fails closed if the dedicated billing secret is not configured", async () => {
        config.HELP_SCOUT_BILLING_SECRET = "";
        expect((await request(app).get(signed())).status).toBe(503);
    });
    it("rejects light users and follows inbox-user pagination", async () => {
        const original =
            BillingSidebarService.prototype.read.getMockImplementation();
        BillingSidebarService.prototype.read.mockImplementation(
            async (path) => {
                if (path.startsWith("/users?"))
                    return {
                        _embedded: {
                            users: [
                                { id: 7, type: "user", role: "light user" },
                            ],
                        },
                    };
                return original(path);
            },
        );
        expect((await load()).status).toBe(403);
        BillingSidebarService.prototype.read.mockImplementation(
            async (path) => {
                if (path.startsWith("/users?"))
                    return {
                        _embedded: {
                            users: path.endsWith("page=2")
                                ? [{ id: 7, type: "user", role: "user" }]
                                : [],
                        },
                        page: { totalPages: 2 },
                    };
                return original(path);
            },
        );
        expect((await load()).status).toBe(200);
    });
    it("refuses ambiguous subscription records instead of choosing the wrong one", async () => {
        await Subscription.create({
            userId: user._id,
            stripeSubscriptionId: "sub_second",
            status: "active",
            currentPeriodStart: new Date("2026-11-01"),
            currentPeriodEnd: new Date("2026-12-01"),
        });
        const response = await load();
        expect(response.status).toBe(409);
        expect(response.text).toContain(
            "Multiple subscription records need review",
        );
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("loads live chats without a conversation ID, without exposing a permanent secret", async () => {
        const boot = await request(app).get(signed());
        expect(boot.text).toContain("client.js");
        expect(boot.text).not.toContain(KEY);
        expect(boot.headers["cache-control"]).toBe("no-store");
        expect(boot.headers["x-frame-options"]).toBeUndefined();
        expect(boot.headers["content-security-policy"]).toContain(
            "frame-ancestors https://secure.helpscout.net",
        );
        const response = await load();
        expect(response.status).toBe(200);
        expect(response.text).toContain(user.email);
        expect(response.text).toContain("Monthly membership");
        expect(response.text).toContain("Reports or insights were too basic.");
    });
    it("supports ordinary tickets and rejects another inbox", async () => {
        expect((await load({ conversationId: "123" })).status).toBe(200);
        inboxId = 350186;
        expect((await load({ conversationId: "123" })).status).toBe(403);
    });
    it("rejects agents without Bazzingo inbox access", async () => {
        jest.spyOn(
            BillingSidebarService.prototype,
            "authorizeAgent",
        ).mockRejectedValue(require("http-errors")(403, "No inbox access"));
        expect((await load()).status).toBe(403);
    });
    it("rejects browser-supplied account targets and resolves only verified emails", async () => {
        email = "not-found@example.com";
        expect(
            (
                await load({
                    customerId: "42",
                    email: user.email,
                    userId: String(user._id),
                })
            ).status,
        ).toBe(404);
    });
    it("requires confirmation and the same reason/retention survey as the web flow", async () => {
        const response = await load();
        for (const patch of [
            { confirmed: "no" },
            { reason: "invented" },
            { wouldHaveStayedIfOffered: [] },
            { reason: "Other", other: "x".repeat(501) },
        ]) {
            expect(
                (
                    await request(app)
                        .post(`${PREFIX}/cancel`)
                        .send({ ...cancelBody(response.text), ...patch })
                ).status,
            ).toBe(400);
        }
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
    it("uses the existing Stripe service, always cancels at period end, and syncs the survey", async () => {
        const response = await load();
        const result = await request(app)
            .post(`${PREFIX}/cancel`)
            .type("form")
            .send({
                ...cancelBody(response.text),
                cancelAtPeriodEnd: false,
                immediate: true,
            });
        expect(result.status).toBe(200);
        expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
            "sub_sidebar",
            {
                cancel_at_period_end: true,
                metadata: {
                    existing: "value",
                    bazingo_cancel_reason: "Too expensive.",
                    bazingo_stay_if_offered: '["Lower-cost subscription"]',
                },
            },
        );
        expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
        expect(
            (await Subscription.findOne({ userId: user._id }))
                .cancelAtPeriodEnd,
        ).toBe(true);
        expect(
            KlaviyoSyncService.prototype.syncSubscription,
        ).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
        expect(result.text).toContain("Renewal already cancelled.");
    });
    it("does not cancel a subscription replaced during the cancellation request", async () => {
        const response = await load();
        const original = StripeService.prototype.cancelSubscription;
        jest.spyOn(
            StripeService.prototype,
            "cancelSubscription",
        ).mockImplementationOnce(async function (args) {
            await Subscription.updateOne(
                { userId: user._id },
                {
                    $set: {
                        stripeSubscriptionId: "sub_replaced_during_request",
                    },
                },
            );
            return original.call(this, args);
        });
        expect(
            (
                await request(app)
                    .post(`${PREFIX}/cancel`)
                    .send(cancelBody(response.text))
            ).status,
        ).toBe(409);
        expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("does not cancel a replacement subscription from an old panel", async () => {
        const response = await load();
        await Subscription.updateOne(
            { userId: user._id },
            { $set: { stripeSubscriptionId: "sub_replacement" } },
        );
        expect(
            (
                await request(app)
                    .post(`${PREFIX}/cancel`)
                    .send(cancelBody(response.text))
            ).status,
        ).toBe(409);
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
    it("rechecks the customer before acting and does not reveal the old account on error", async () => {
        const response = await load();
        email = "changed@example.com";
        const result = await request(app)
            .post(`${PREFIX}/cancel`)
            .send(cancelBody(response.text));
        expect(result.status).toBe(404);
        expect(result.text).not.toContain(user.email);
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
    it("expires session tokens and separates view/cancellation token purposes", async () => {
        const response = await load();
        const claims = jwt.decode(sessionToken(response.text));
        delete claims.exp;
        const expired = jwt.sign(claims, KEY, { expiresIn: -1 });
        expect(
            (
                await request(app)
                    .post(`${PREFIX}/cancel`)
                    .send({ ...cancelBody(response.text), token: expired })
            ).status,
        ).toBe(401);
        const boot = await request(app).get(signed());
        expect(
            (
                await request(app)
                    .post(`${PREFIX}/cancel`)
                    .send({
                        ...cancelBody(response.text),
                        token: contextToken(boot.text),
                    })
            ).status,
        ).toBe(401);
    });
    it("supports trial subscriptions and does not refill or charge anything while reading", async () => {
        await Subscription.updateOne(
            { userId: user._id },
            { $set: { status: "trialing" } },
        );
        const response = await load();
        expect(response.text).toContain("Monthly membership trial");
        expect(response.text).toContain("trial will not convert");
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
    it("shows accounts without subscriptions and makes repeated cancellation idempotent", async () => {
        await Subscription.updateOne(
            { userId: user._id },
            { $set: { cancelAtPeriodEnd: true } },
        );
        const response = await load();
        expect(
            (
                await request(app)
                    .post(`${PREFIX}/cancel`)
                    .send(cancelBody(response.text))
            ).status,
        ).toBe(200);
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
        await Subscription.deleteMany({ userId: user._id });
        expect((await load()).text).toContain("No subscription found");
    });
});
