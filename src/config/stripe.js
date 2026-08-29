const { config } = require(".");
const logger = require("./logger");

let client = null;

const getStripe = () => {
    if (client) {
        return client;
    }

    if (!config.STRIPE_SECRET_KEY) {
        logger.warn("Stripe is not initialized, STRIPE_SECRET_KEY is missing");

        return null;
    }

    try {
        const Stripe = require("stripe").default || require("stripe");

        client = new Stripe(config.STRIPE_SECRET_KEY, {
            apiVersion: config.STRIPE_API_VERSION,
            appInfo: { name: "bazzingo", version: "1.0.0" },
        });

        logger.info("Stripe client initialized");
    } catch (error) {
        logger.error("Failed to initialize Stripe", { reason: error.message });
    }

    return client;
};

module.exports = { getStripe };
