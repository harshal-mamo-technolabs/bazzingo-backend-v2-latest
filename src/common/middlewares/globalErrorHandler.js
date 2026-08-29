const logger = require("../../config/logger");
const { RESPONSE_STATUS } = require("../../constants");
const { sendResponse } = require("../utils/response");

const globalErrorHandler = (err, req, res, next) => {
    const statusCode = err.status || err.statusCode || 500;
    const isServerError = statusCode >= 500;
    const message = isServerError ? "Something went wrong" : err.message;

    const logPayload = {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode,
        userId: req.user ? String(req.user._id) : null,
        context: err.context,
        stack: err.stack,
    };

    if (isServerError) {
        logger.error(err.message, logPayload);
    } else {
        logger.warn(err.message, logPayload);
    }

    return sendResponse(res, {
        statusCode,
        status: RESPONSE_STATUS.ERROR,
        message,
        context: err.context,
    });
};

module.exports = globalErrorHandler;
