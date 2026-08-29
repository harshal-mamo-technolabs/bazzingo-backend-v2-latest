const webpush = require("web-push");
const { config } = require("../../config");
const logger = require("../../config/logger");
const { EXPIRED_PUSH_STATUS_CODES } = require("../../constants");

const ensureVapidConfigured = () => {
    const missing = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_CONTACT"]
        .filter((key) => !config[key])
        .join(", ");

    if (missing) {
        throw new Error(`VAPID configuration missing: ${missing}`);
    }

    webpush.setVapidDetails(
        `mailto:${config.VAPID_CONTACT}`,
        config.VAPID_PUBLIC_KEY,
        config.VAPID_PRIVATE_KEY,
    );
};

const sendWebPush = async (subscription, payload) => {
    try {
        ensureVapidConfigured();

        await webpush.sendNotification(subscription, JSON.stringify(payload));

        logger.info("Web push delivered", {
            endpoint: subscription.endpoint,
        });

        return { ok: true };
    } catch (err) {
        if (EXPIRED_PUSH_STATUS_CODES.includes(err?.statusCode)) {
            logger.warn("Web push subscription is expired", {
                endpoint: subscription.endpoint,
                statusCode: err.statusCode,
            });

            return { ok: false, remove: true };
        }

        logger.error("Web push failed", {
            endpoint: subscription.endpoint,
            statusCode: err?.statusCode,
            message: err?.message,
        });

        return { ok: false, error: err };
    }
};

module.exports = { sendWebPush, ensureVapidConfigured };
