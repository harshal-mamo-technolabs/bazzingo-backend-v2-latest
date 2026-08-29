const { randomUUID } = require("crypto");
const logger = require("../../config/logger");

const requestLogger = (req, res, next) => {
    req.requestId = randomUUID();
    const startedAt = process.hrtime.bigint();

    res.setHeader("x-request-id", req.requestId);

    logger.info("Incoming request", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
    });

    res.on("finish", () => {
        const durationMs =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        logger.info("Request completed", {
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Number(durationMs.toFixed(2)),
            userId: req.user ? String(req.user._id) : null,
        });
    });

    next();
};

module.exports = requestLogger;
