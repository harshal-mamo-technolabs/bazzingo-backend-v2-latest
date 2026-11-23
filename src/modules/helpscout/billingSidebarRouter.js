const express = require("express");
const crypto = require("crypto");
const path = require("path");
const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const { config } = require("../../config");
const logger = require("../../config/logger");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { getStripe } = require("../../config/stripe");
const { HelpscoutService } = require("./helpscoutService");
const { BillingSidebarService } = require("./billingSidebarService");
const { StripeService } = require("../stripe/stripeService");
const { KlaviyoSyncService } = require("../lp/klaviyoSyncService");
const { KlaviyoService } = require("../klaviyo/klaviyoService");
const { AssessmentService } = require("../assessment/assessmentService");
const { LeaderboardService } = require("../leaderboard/leaderboardService");
const {
    CANCEL_REASONS,
    STAY_OPTIONS,
    escape,
    page,
    renderSubscription,
} = require("./billingSidebarTemplate");

const stripe = getStripe();
const klaviyo = new KlaviyoSyncService(
    logger,
    new KlaviyoService(logger),
    new AssessmentService(logger),
    new LeaderboardService(logger),
    stripe,
);
const service = new BillingSidebarService(
    new HelpscoutService(logger),
    new StripeService(logger, stripe, klaviyo),
    logger,
);
const router = express.Router();
const issuer = "bazzingo-helpscout-billing";

router.use((req, res, next) => {
    res.removeHeader("X-Frame-Options");
    res.set({
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
            "default-src 'none'; script-src 'self' https://esm.sh; connect-src 'self' https://esm.sh; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors https://secure.helpscout.net; base-uri 'none'",
    });
    next();
});
router.use(express.json({ limit: "12kb" }));
router.use(express.urlencoded({ extended: false, limit: "12kb" }));
function secret() {
    if (
        !config.HELP_SCOUT_BILLING_SECRET ||
        !/^\d+$/.test(config.HELP_SCOUT_BILLING_INBOX_ID)
    )
        throw createHttpError(
            503,
            "The Bazzingo billing sidebar is not configured.",
        );
    return config.HELP_SCOUT_BILLING_SECRET;
}
function sign(data, audience) {
    return jwt.sign(data, secret(), {
        algorithm: "HS256",
        issuer,
        audience,
        expiresIn: "15m",
    });
}
function verify(token, audience) {
    try {
        if (typeof token !== "string") throw new Error("Missing token");
        const claims = jwt.verify(token, secret(), {
            algorithms: ["HS256"],
            issuer,
            audience,
        });
        if (!/^\d+$/.test(claims.agentId))
            throw new Error("Missing agent identity");
        return claims;
    } catch {
        throw createHttpError(
            401,
            "This sidebar session expired. Reload the app in Help Scout.",
        );
    }
}
function boundSession(req) {
    const data = verify(req.body?.token, "subscription");
    if (
        !data.userId ||
        !data.email ||
        !data.reference ||
        !["conversation", "customer"].includes(data.reference.kind) ||
        !/^\d+$/.test(data.reference.id)
    )
        throw createHttpError(
            401,
            "Invalid sidebar session. Reload the app in Help Scout.",
        );
    return {
        userId: data.userId,
        email: data.email,
        agentId: data.agentId,
        reference: data.reference,
        subscriptionId: data.subscriptionId,
    };
}
async function render(res, session, message = "", error = "") {
    const subscription = await service.subscription(session.userId);
    res.type("html").send(
        renderSubscription(
            session,
            subscription,
            sign(session, "subscription"),
            {
                token: sign({ agentId: session.agentId }, "context"),
                id: `${session.reference.kind}:${session.reference.id}`,
            },
            message,
            error,
        ),
    );
}
router.get("/client.js", (req, res) =>
    res.sendFile(path.join(__dirname, "billingSidebarClient.js")),
);
router.get(
    "/",
    asyncWrapper(async (req, res) => {
        const params = Object.create(null);
        for (const [key, value] of new URL(
            req.originalUrl,
            "https://sidebar.invalid",
        ).searchParams) {
            if (Object.hasOwn(params, key))
                throw createHttpError(401, "Invalid Help Scout signature.");
            params[key] = value;
        }
        const signature = params["X-HelpScout-Signature"] || "";
        delete params["X-HelpScout-Signature"];
        const expected = crypto
            .createHmac("sha1", secret())
            .update(JSON.stringify(params))
            .digest("base64");
        if (
            Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
            !crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expected),
            )
        )
            throw createHttpError(
                401,
                "Open this billing app from Help Scout.",
            );
        const agentId = params["user-id"];
        if (!agentId || !/^\d+$/.test(agentId))
            throw createHttpError(
                401,
                "Help Scout did not supply an agent identity.",
            );
        res.type("html").send(
            page('<p role="status">Loading the customer from Help Scout…</p>', {
                token: sign({ agentId }, "context"),
                id: "",
            }),
        );
    }),
);
router.post(
    "/context",
    asyncWrapper(async (req, res) => {
        const { agentId } = verify(req.body?.token, "context");
        const body = req.body;
        if (
            body.mailboxId !== undefined &&
            body.mailboxId !== config.HELP_SCOUT_BILLING_INBOX_ID &&
            body.mailboxId !== Number(config.HELP_SCOUT_BILLING_INBOX_ID)
        )
            throw createHttpError(
                403,
                "This panel is available only in Bazzingo Inbox.",
            );
        let reference;
        if (
            typeof body.conversationId === "string" &&
            /^\d+$/.test(body.conversationId)
        )
            reference = { kind: "conversation", id: body.conversationId };
        else if (
            typeof body.customerId === "string" &&
            /^\d+$/.test(body.customerId)
        )
            reference = { kind: "customer", id: body.customerId };
        else
            throw createHttpError(
                400,
                "Select a customer in Help Scout to view their subscription.",
            );
        await render(res, await service.resolve(agentId, reference));
    }),
);
router.post(
    "/refresh",
    asyncWrapper(async (req, res) => {
        await render(res, await service.recheck(boundSession(req)));
    }),
);
router.post(
    "/cancel",
    asyncWrapper(async (req, res) => {
        const session = boundSession(req);
        try {
            const body = req.body;
            if (body.confirmed !== "yes")
                throw createHttpError(
                    400,
                    "Confirm the cancellation before submitting.",
                );
            if (!CANCEL_REASONS.includes(body.reason))
                throw createHttpError(400, "Select a cancellation reason.");
            if (
                body.other !== undefined &&
                (typeof body.other !== "string" || body.other.length > 500)
            )
                throw createHttpError(
                    400,
                    "Other details must be at most 500 characters.",
                );
            const cancelReason =
                body.reason === "Other"
                    ? body.other?.trim() || "Other"
                    : body.reason;
            const raw = body.wouldHaveStayedIfOffered;
            const answers =
                raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
            if (
                !answers.length ||
                !answers.every(
                    (value) =>
                        typeof value === "string" &&
                        STAY_OPTIONS.includes(value),
                )
            )
                throw createHttpError(
                    400,
                    "Select at least one of the displayed retention answers.",
                );
            await service.cancel(session, {
                cancelReason,
                wouldHaveStayedIfOffered: [...new Set(answers)],
            });
            await render(
                res,
                session,
                "Subscription renewal cancelled. Access continues until the period ends.",
            );
        } catch (error) {
            if (!createHttpError.isHttpError(error)) throw error;
            // Do not render the old customer's account again if its binding changed.
            await service.recheck(session);
            res.status(error.statusCode);
            await render(res, session, "", error.message);
        }
    }),
);
router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (!createHttpError.isHttpError(error))
        logger.error("Bazzingo billing sidebar failed", {
            error: error.message,
        });
    res.status(createHttpError.isHttpError(error) ? error.statusCode : 500)
        .type("html")
        .send(
            page(
                `<p role="alert" class="error">${escape(createHttpError.isHttpError(error) ? error.message : "Could not load billing details. Refresh and try again.")}</p>`,
            ),
        );
});
module.exports = router;
