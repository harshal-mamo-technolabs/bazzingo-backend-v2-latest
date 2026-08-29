const createHttpError = require("http-errors");
const { config } = require("../../config");
const logger = require("../../config/logger");
const {
    AUTH_MESSAGES,
    HELPSCOUT_MESSAGES,
    HELPSCOUT_API,
} = require("../../constants");

const requireHelpScoutAppAuth = (req, res, next) => {
    const secret = config.HELP_SCOUT_APP_SECRET || config.HELP_SCOUT_SECRET;

    if (!secret) {
        logger.error("Help Scout app secret is not configured", {
            requestId: req.requestId,
            path: req.originalUrl,
        });

        return next(
            createHttpError(500, HELPSCOUT_MESSAGES.APP_SECRET_NOT_CONFIGURED),
        );
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith(HELPSCOUT_API.BEARER_PREFIX)) {
        logger.warn("Help Scout app authorization header missing", {
            requestId: req.requestId,
            path: req.originalUrl,
        });

        return next(
            createHttpError(401, AUTH_MESSAGES.AUTHENTICATION_REQUIRED),
        );
    }

    if (authHeader.slice(7).trim() !== secret) {
        logger.warn("Help Scout app token rejected", {
            requestId: req.requestId,
            path: req.originalUrl,
        });

        return next(
            createHttpError(401, HELPSCOUT_MESSAGES.INVALID_CREDENTIALS),
        );
    }

    logger.info("Help Scout app request authenticated", {
        requestId: req.requestId,
        path: req.originalUrl,
    });

    return next();
};

module.exports = { requireHelpScoutAppAuth };
