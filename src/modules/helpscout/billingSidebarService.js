const createHttpError = require("http-errors");
const { config } = require("../../config");
const User = require("../user/userModel");
const Subscription = require("../stripe/subscriptionModel");

class BillingSidebarService {
    constructor(helpscout, stripeService, logger) {
        this.helpscout = helpscout;
        this.stripeService = stripeService;
        this.logger = logger;
    }

    async read(path) {
        if (!this.helpscout.isMailboxApiConfigured()) {
            throw createHttpError(
                503,
                "Help Scout Inbox API credentials are not configured.",
            );
        }
        const response = await this.helpscout.mailboxRequest(path, {
            signal: AbortSignal.timeout(10000),
            redirect: "error",
        });
        if (!response.ok)
            throw createHttpError(
                502,
                "Could not verify Help Scout data. Reload the panel and try again.",
            );
        return response.json();
    }

    async authorizeAgent(agentId) {
        for (let page = 1; ; page++) {
            const data = await this.read(
                `/users?mailbox=${config.HELP_SCOUT_BILLING_INBOX_ID}&page=${page}`,
            );
            const users = data._embedded?.users;
            if (!Array.isArray(users))
                throw createHttpError(502, "Could not verify inbox access.");
            if (
                users.some(
                    (user) =>
                        String(user.id) === agentId &&
                        user.type === "user" &&
                        ["owner", "admin", "user"].includes(user.role),
                )
            )
                return;
            const pages = data.page?.totalPages ?? 1;
            if (!Number.isSafeInteger(pages) || page >= pages) break;
        }
        throw createHttpError(
            403,
            "This agent does not have access to Bazzingo Inbox.",
        );
    }

    async resolve(agentId, reference) {
        await this.authorizeAgent(agentId);
        let emails;
        if (reference.kind === "conversation") {
            const conversation = await this.read(
                `/conversations/${reference.id}`,
            );
            if (
                String(conversation.mailboxId) !==
                config.HELP_SCOUT_BILLING_INBOX_ID
            )
                throw createHttpError(
                    403,
                    "This panel is available only in Bazzingo Inbox.",
                );
            if (
                String(conversation.id) !== reference.id ||
                typeof conversation.primaryCustomer?.email !== "string"
            )
                throw createHttpError(
                    502,
                    "Help Scout returned an incomplete conversation.",
                );
            emails = [conversation.primaryCustomer.email];
        } else {
            const customer = await this.read(`/customers/${reference.id}`);
            if (
                String(customer.id) !== reference.id ||
                !Array.isArray(customer._embedded?.emails)
            )
                throw createHttpError(
                    502,
                    "Help Scout returned an incomplete customer.",
                );
            emails = customer._embedded.emails
                .map((item) => item.value)
                .filter((value) => typeof value === "string");
        }
        emails = emails
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean);
        if (!emails.length)
            throw createHttpError(
                404,
                "Add the customer's account email in Help Scout, then refresh this panel.",
            );
        const users = await User.find({ email: { $in: emails } })
            .select("email name")
            .limit(2)
            .lean();
        if (!users.length)
            throw createHttpError(
                404,
                "No Bazzingo account matches this Help Scout customer's email.",
            );
        if (users.length !== 1)
            throw createHttpError(
                409,
                "This contact matches multiple Bazzingo accounts. Use a contact with only the requested account's email.",
            );
        const user = users[0];
        const subscription = await this.subscription(String(user._id));
        return {
            agentId,
            reference,
            userId: String(user._id),
            email: user.email,
            subscriptionId: subscription?.stripeSubscriptionId ?? null,
        };
    }

    async subscription(userId) {
        // The existing cancellation service targets findOne({ userId }); refuse ambiguity.
        const subscriptions = await Subscription.find({ userId })
            .limit(2)
            .populate({
                path: "priceCatalogId",
                select: "planId",
                populate: { path: "planId", model: "Plan", select: "name" },
            })
            .lean();
        if (subscriptions.length > 1)
            throw createHttpError(
                409,
                "Multiple subscription records need review. No cancellation was made.",
            );
        return subscriptions[0] ?? null;
    }

    async recheck(session) {
        const current = await this.resolve(session.agentId, session.reference);
        if (
            current.userId !== session.userId ||
            current.email !== session.email
        )
            throw createHttpError(
                409,
                "The Help Scout customer changed. Reload this panel.",
            );
        return current;
    }

    async cancel(session, body) {
        const current = await this.recheck(session);
        if (
            !session.subscriptionId ||
            session.subscriptionId !== current.subscriptionId
        )
            throw createHttpError(
                409,
                "The subscription changed. Refresh before cancelling.",
            );
        const subscription = await this.subscription(session.userId);
        if (
            !subscription ||
            !["active", "trialing", "past_due", "unpaid"].includes(
                subscription.status,
            )
        )
            throw createHttpError(
                400,
                "There is no renewable subscription to cancel.",
            );
        if (subscription.cancelAtPeriodEnd) return;
        await this.stripeService.cancelSubscription({
            userId: session.userId,
            cancelAtPeriodEnd: true,
            expectedSubscriptionId: session.subscriptionId,
            body,
        });
        this.logger.info("Help Scout subscription renewal cancelled", {
            userId: session.userId,
            agentId: session.agentId,
            helpScoutReference: session.reference,
            subscriptionId: session.subscriptionId,
            reason: body.cancelReason,
        });
    }
}
module.exports = { BillingSidebarService };
