const {
    PLAN_MESSAGES,
    PLAN_PRICE_TYPES,
    PLAN_PRICE_SELECT_FIELDS,
    PLAN_STRIPE_PRODUCT_TYPE,
    PLAN_UNIT_AMOUNT_DIVISOR,
    PLAN_DEFAULT_INTERVAL_COUNT,
} = require("../../constants");
const PriceCatalog = require("../price-catalog/priceCatalogModel");
const Plan = require("./planModel");

const toMajorUnits = (price) => {
    if (!price) {
        return null;
    }

    return {
        ...price,
        unitAmount:
            typeof price.unitAmount === "number"
                ? price.unitAmount / PLAN_UNIT_AMOUNT_DIVISOR
                : price.unitAmount,
    };
};

const normalizePlanPrices = (plan) => ({
    ...plan,
    prices: {
        monthly: plan.prices?.monthly
            ? {
                  ...plan.prices.monthly,
                  priceId: toMajorUnits(plan.prices.monthly.priceId),
              }
            : null,
        yearly: plan.prices?.yearly
            ? {
                  ...plan.prices.yearly,
                  priceId: toMajorUnits(plan.prices.yearly.priceId),
              }
            : null,
        trial: toMajorUnits(plan.prices?.trial),
    },
});

const toIntervalCount = (value) =>
    Number.isFinite(value)
        ? Math.max(
              parseInt(value, 10) || PLAN_DEFAULT_INTERVAL_COUNT,
              PLAN_DEFAULT_INTERVAL_COUNT,
          )
        : PLAN_DEFAULT_INTERVAL_COUNT;

class PlanService {
    constructor(logger, stripe) {
        this.logger = logger;
        this.stripe = stripe;
    }

    async createWithStripeProduct({ name, description, metadata }) {
        this.logger.info("Creating a stripe product for a new plan", { name });

        if (!this.stripe) {
            this.logger.error("Stripe client is not configured", { name });

            throw new Error(PLAN_MESSAGES.STRIPE_NOT_CONFIGURED);
        }

        try {
            const product = await this.stripe.products.create({
                name,
                description: description || undefined,
                metadata: { type: PLAN_STRIPE_PRODUCT_TYPE, ...metadata },
            });

            const plan = await Plan.create({
                name,
                description,
                stripeProductId: product.id,
                active: true,
                prices: {
                    monthly: { intervalCount: PLAN_DEFAULT_INTERVAL_COUNT },
                    yearly: { intervalCount: PLAN_DEFAULT_INTERVAL_COUNT },
                },
            });

            this.logger.info("Plan created from a stripe product", {
                planId: String(plan._id),
                stripeProductId: product.id,
            });

            return { plan, stripeProductId: product.id };
        } catch (error) {
            this.logger.error("Failed to create a plan from stripe", {
                name,
                reason: error.message,
            });

            throw error;
        }
    }

    async deactivateStripeProduct(stripeProductId) {
        if (!stripeProductId) {
            return;
        }

        this.logger.warn("Deactivating the stripe product after a failure", {
            stripeProductId,
        });

        try {
            await this.stripe.products.update(stripeProductId, {
                active: false,
            });

            this.logger.info("Stripe product deactivated", {
                stripeProductId,
            });
        } catch (error) {
            this.logger.error("Failed to deactivate the stripe product", {
                stripeProductId,
                reason: error.message,
            });
        }
    }

    async listWithPrices() {
        this.logger.info("Reading every plan with its prices");

        const plans = await Plan.find()
            .populate([
                {
                    path: "prices.monthly.priceId",
                    select: PLAN_PRICE_SELECT_FIELDS,
                },
                {
                    path: "prices.yearly.priceId",
                    select: PLAN_PRICE_SELECT_FIELDS,
                },
                { path: "prices.trial", select: PLAN_PRICE_SELECT_FIELDS },
            ])
            .sort({ createdAt: -1 })
            .lean();

        this.logger.info("Plans read", { count: plans.length });

        return plans.map(normalizePlanPrices);
    }

    async findById(planId) {
        this.logger.info("Reading a plan", { planId: String(planId) });

        const plan = await Plan.findById(planId);

        if (!plan) {
            this.logger.warn("Plan not found", { planId: String(planId) });
        }

        return plan;
    }

    async findPopulated(planId) {
        this.logger.info("Reading a populated plan", {
            planId: String(planId),
        });

        return await Plan.findById(planId)
            .populate("prices.monthly.priceId")
            .populate("prices.yearly.priceId")
            .populate("prices.trial")
            .lean();
    }

    async findPriceInCatalog(priceId) {
        this.logger.info("Reading a price from the catalog", {
            priceId: String(priceId),
        });

        const price = await PriceCatalog.findById(priceId);

        if (!price) {
            this.logger.warn("Price not found in the catalog", {
                priceId: String(priceId),
            });
        }

        return price;
    }

    async attachPrices(
        plan,
        {
            monthlyPriceId,
            monthlyIntervalCount,
            yearlyPriceId,
            yearlyIntervalCount,
            trialPriceId,
        },
    ) {
        this.logger.info("Attaching prices to a plan", {
            planId: String(plan._id),
            monthlyPriceId,
            yearlyPriceId,
            trialPriceId,
        });

        if (monthlyPriceId) {
            plan.prices.monthly = {
                priceId: monthlyPriceId,
                intervalCount: monthlyIntervalCount,
            };
        }

        if (yearlyPriceId) {
            plan.prices.yearly = {
                priceId: yearlyPriceId,
                intervalCount: yearlyIntervalCount,
            };
        }

        if (trialPriceId) {
            plan.prices.trial = trialPriceId;
        }

        await plan.save();

        this.logger.info("Plan prices attached", { planId: String(plan._id) });

        return await this.findPopulated(plan._id);
    }

    async attachPrice(plan, { priceType, priceId, intervalCount }) {
        this.logger.info("Attaching a single price to a plan", {
            planId: String(plan._id),
            priceType,
            priceId: String(priceId),
        });

        if (priceType === PLAN_PRICE_TYPES.TRIAL) {
            plan.prices.trial = priceId;
        } else {
            plan.prices[priceType] = {
                priceId,
                intervalCount: parseInt(intervalCount, 10),
            };
        }

        await plan.save();

        this.logger.info("Price attached to the plan", {
            planId: String(plan._id),
            priceType,
        });

        return await this.findPopulated(plan._id);
    }

    async createDirect({ name, description, stripeProductId, prices, active }) {
        this.logger.info("Creating a plan directly", { name });

        const doc = {
            name,
            description,
            stripeProductId,
            active: Boolean(active),
            prices: {
                monthly: prices?.monthly
                    ? {
                          priceId: prices.monthly.priceId,
                          intervalCount: toIntervalCount(
                              prices.monthly.intervalCount,
                          ),
                      }
                    : undefined,
                yearly: prices?.yearly
                    ? {
                          priceId: prices.yearly.priceId,
                          intervalCount: toIntervalCount(
                              prices.yearly.intervalCount,
                          ),
                      }
                    : undefined,
                trial: prices?.trial || undefined,
            },
        };

        if (!doc.prices.monthly) {
            delete doc.prices.monthly;
        }

        if (!doc.prices.yearly) {
            delete doc.prices.yearly;
        }

        if (!doc.prices.trial) {
            delete doc.prices.trial;
        }

        if (Object.keys(doc.prices).length === 0) {
            delete doc.prices;
        }

        const plan = await Plan.create(doc);

        this.logger.info("Plan created directly", {
            planId: String(plan._id),
        });

        return await this.findPopulated(plan._id);
    }
}

module.exports = { PlanService };
