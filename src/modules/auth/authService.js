const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { config } = require("../../config");
const {
    BCRYPT_SALT_ROUNDS,
    AVATAR_COUNT,
    DUMMY_SUBSCRIPTION,
    TEN_YEAR_SUBSCRIPTION,
} = require("../../constants");
const PriceCatalog = require("../price-catalog/priceCatalogModel");
const Plan = require("../plan/planModel");
const Subscription = require("../stripe/subscriptionModel");
const User = require("../user/userModel");

class AuthService {
    constructor(logger, { stripeClient, googleVerifier, sendEmail }) {
        this.logger = logger;
        this.stripeClient = stripeClient;
        this.googleVerifier = googleVerifier;
        this.sendEmail = sendEmail;
    }

    randomAvatar() {
        return `/avatar/person${crypto.randomInt(1, AVATAR_COUNT + 1)}.png`;
    }

    async hashPassword(password) {
        return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    }

    async comparePassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    issueToken(userId, expiresIn) {
        return jwt.sign({ userId }, config.JWT_SECRET, { expiresIn });
    }

    verifyToken(token) {
        return jwt.verify(token, config.JWT_SECRET);
    }

    async findByEmail(email) {
        return await User.findOne({ email });
    }

    async findByMsisdn(msisdn) {
        return await User.findOne({ msisdn });
    }

    async findById(userId) {
        return await User.findById(userId);
    }

    hashResetToken(token) {
        return crypto.createHash("sha256").update(token).digest("hex");
    }

    async findByResetToken(token) {
        return await User.findOne({
            passwordResetToken: this.hashResetToken(token),
        });
    }

    async createUser(fields) {
        this.logger.info("Persisting a new user", { email: fields.email });

        return await User.create(fields);
    }

    async createStripeCustomer({ name, email }) {
        if (!this.stripeClient) {
            this.logger.warn("Stripe is not configured, skipping customer", {
                email,
            });
            return null;
        }

        try {
            const customer = await this.stripeClient.customers.create({
                name,
                email,
            });

            this.logger.info("Stripe customer created", {
                email,
                stripeCustomerId: customer.id,
            });

            return customer.id;
        } catch (err) {
            this.logger.error("Stripe customer creation failed", {
                email,
                message: err.message,
            });

            return null;
        }
    }

    async verifyGoogleIdToken(idToken) {
        const ticket = await this.googleVerifier.verifyIdToken({
            idToken,
            audience: config.GOOGLE_CLIENT_ID,
        });

        return ticket.getPayload();
    }

    async createDummySubscription(userId) {
        try {
            const existing = await Subscription.findOne({ userId }).lean();

            if (existing) {
                this.logger.info("User already has a subscription", {
                    userId: String(userId),
                });
                return null;
            }

            const plan = await Plan.findOne({
                active: true,
                "prices.monthly.priceId": { $exists: true },
            }).lean();

            if (!plan) {
                this.logger.info("No active monthly plan for a dummy sub", {
                    userId: String(userId),
                });
                return null;
            }

            const priceCatalog = await PriceCatalog.findById(
                plan.prices.monthly.priceId,
            ).lean();

            if (!priceCatalog) {
                this.logger.info("No price catalog for a dummy subscription", {
                    userId: String(userId),
                    planId: String(plan._id),
                });
                return null;
            }

            const now = new Date();
            const currentPeriodEnd = new Date(now);
            currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

            const subscription = await Subscription.create({
                userId,
                stripeSubscriptionId: `sub_dummy_${userId}_${Date.now()}`,
                stripeSessionId: null,
                priceCatalogId: priceCatalog._id,
                planId: plan._id.toString(),
                status: DUMMY_SUBSCRIPTION.STATUS,
                billingAmounts: [
                    {
                        amount: priceCatalog.unitAmount || 0,
                        currency:
                            priceCatalog.currency ||
                            DUMMY_SUBSCRIPTION.DEFAULT_CURRENCY,
                        date: now,
                    },
                ],
                nextBillingDate: new Date(currentPeriodEnd),
                planDuration: DUMMY_SUBSCRIPTION.DURATION,
                cancelAt: null,
                cancelAtPeriodEnd: false,
                currentPeriodStart: new Date(now),
                currentPeriodEnd,
                trialStart: null,
                trialEnd: null,
                metadata: new Map([
                    ["created_by", DUMMY_SUBSCRIPTION.CREATED_BY],
                    ["is_dummy", "true"],
                    ["created_at", now.toISOString()],
                ]),
            });

            this.logger.info("Dummy subscription created", {
                userId: String(userId),
                subscriptionId: String(subscription._id),
            });

            return subscription;
        } catch (err) {
            this.logger.error("Dummy subscription creation failed", {
                userId: String(userId),
                message: err.message,
            });

            return null;
        }
    }

    async createTenYearSubscription(userId) {
        try {
            const startDate = new Date();
            const endDate = new Date();
            endDate.setFullYear(
                endDate.getFullYear() + TEN_YEAR_SUBSCRIPTION.YEARS,
            );

            const subscription = await Subscription.create({
                userId,
                stripeSubscriptionId: `manual_10yr_${Date.now()}_${userId}`,
                status: TEN_YEAR_SUBSCRIPTION.STATUS,
                planDuration: TEN_YEAR_SUBSCRIPTION.DURATION,
                currentPeriodStart: startDate,
                currentPeriodEnd: endDate,
                billingAmounts: [
                    {
                        amount: 0,
                        currency: TEN_YEAR_SUBSCRIPTION.CURRENCY,
                        date: startDate,
                        billingReason: "manual",
                    },
                ],
                metadata: {
                    source: TEN_YEAR_SUBSCRIPTION.SOURCE,
                    duration: "10_years",
                    isFree: "true",
                },
            });

            this.logger.info("Ten year subscription created", {
                userId: String(userId),
                subscriptionId: String(subscription._id),
            });

            return subscription;
        } catch (err) {
            this.logger.error("Ten year subscription creation failed", {
                userId: String(userId),
                message: err.message,
            });

            return null;
        }
    }

    async unlockRegistrationBadges(badgeService, userId) {
        const unlockedBadges = [];

        try {
            const rookie =
                await badgeService.unlockLeaderboardRookieBadge(userId);

            if (rookie) {
                unlockedBadges.push(rookie);
            }

            const earlyAdopter =
                await badgeService.unlockEarlyAdopterBadge(userId);

            if (earlyAdopter) {
                unlockedBadges.push(earlyAdopter);
            }

            this.logger.info("Registration badges checked", {
                userId: String(userId),
                unlocked: unlockedBadges.length,
            });
        } catch (err) {
            this.logger.error("Registration badge check failed", {
                userId: String(userId),
                message: err.message,
            });
        }

        return unlockedBadges;
    }
}

module.exports = { AuthService };
