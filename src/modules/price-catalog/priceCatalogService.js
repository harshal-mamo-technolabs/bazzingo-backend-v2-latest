const PriceCatalog = require("./priceCatalogModel");

class PriceCatalogService {
    constructor(logger) {
        this.logger = logger;
    }

    async create({
        assessmentId,
        planId,
        stripePriceId,
        stripeProductId,
        type,
        lookupKey,
        currency,
        unitAmount,
        active,
        isDefault,
        productDuration,
        metadata,
    }) {
        this.logger.info("Creating a price catalog entry", {
            stripePriceId,
            stripeProductId,
            type,
        });

        const price = await PriceCatalog.create({
            ...(assessmentId ? { assessmentId } : {}),
            ...(planId ? { planId } : {}),
            stripePriceId,
            stripeProductId,
            type,
            lookupKey,
            currency: currency.toUpperCase(),
            unitAmount,
            active: Boolean(active),
            default: Boolean(isDefault),
            productDuration,
            metadata: new Map(Object.entries(metadata || {})),
        });

        this.logger.info("Price catalog entry created", {
            priceId: String(price._id),
            stripePriceId,
        });

        return price;
    }
}

module.exports = { PriceCatalogService };
