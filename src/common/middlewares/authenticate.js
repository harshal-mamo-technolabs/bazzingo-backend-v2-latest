const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const { config } = require("../../config");
const logger = require("../../config/logger");
const { AUTH_MESSAGES, ACCOUNT_DELETED_REASON } = require("../../constants");
const User = require("../../modules/user/userModel");

const extractToken = (req) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }

    return authHeader.split(" ")[1] || null;
};

const resolveUser = async (token, requestId) => {
    let decoded;

    try {
        decoded = jwt.verify(token, config.JWT_SECRET);
    } catch (err) {
        logger.warn("Access token rejected", {
            requestId,
            reason: err.message,
        });
        throw createHttpError(401, AUTH_MESSAGES.INVALID_TOKEN);
    }

    const user = await User.findById(decoded.userId);

    if (!user) {
        logger.warn("Access token belongs to a missing user", {
            requestId,
            userId: decoded.userId,
        });
        throw createHttpError(401, AUTH_MESSAGES.INVALID_TOKEN);
    }

    if (user.isDeleted) {
        logger.warn("Deleted account attempted to authenticate", {
            requestId,
            userId: String(user._id),
        });
        throw createHttpError(403, AUTH_MESSAGES.ACCOUNT_DELETED, {
            context: { reason: ACCOUNT_DELETED_REASON },
        });
    }

    logger.info("Request authenticated", {
        requestId,
        userId: String(user._id),
    });

    return user;
};

const requireAuth = async (req, res, next) => {
    try {
        const token = extractToken(req);

        if (!token) {
            logger.warn("Authentication header missing or malformed", {
                requestId: req.requestId,
                path: req.originalUrl,
            });
            throw createHttpError(401, AUTH_MESSAGES.AUTHENTICATION_REQUIRED);
        }

        req.user = await resolveUser(token, req.requestId);

        next();
    } catch (err) {
        next(err);
    }
};

const optionalAuth = async (req, res, next) => {
    try {
        const token = extractToken(req);

        if (token) {
            req.user = await resolveUser(token, req.requestId);
        }

        next();
    } catch (err) {
        next(err);
    }
};

module.exports = { requireAuth, optionalAuth };
