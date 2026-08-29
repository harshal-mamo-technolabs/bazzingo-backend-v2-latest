const { RESPONSE_STATUS } = require("../../constants");

const sendResponse = (res, { statusCode, status, message, data, context }) =>
    res.status(statusCode).json({
        status: status ?? RESPONSE_STATUS.SUCCESS,
        message,
        data: data ?? undefined,
        context: context ?? undefined,
    });

module.exports = { sendResponse };
