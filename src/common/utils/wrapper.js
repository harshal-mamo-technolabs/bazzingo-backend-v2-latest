const createHttpError = require("http-errors");

const MONGOOSE_BAD_REQUEST_ERRORS = ["ValidationError", "CastError"];

const firstValidationMessage = (err) => {
    const [firstError] = Object.values(err.errors || {});

    return firstError ? firstError.message : err.message;
};

const asyncWrapper = (requestHandler) => (req, res, next) =>
    Promise.resolve(requestHandler(req, res, next)).catch((err) => {
        if (createHttpError.isHttpError(err)) {
            return next(err);
        }

        if (MONGOOSE_BAD_REQUEST_ERRORS.includes(err.name)) {
            return next(createHttpError(400, firstValidationMessage(err)));
        }

        if (err instanceof Error) {
            return next(createHttpError(500, err.message));
        }

        return next(createHttpError(500, "Internal server error"));
    });

module.exports = { asyncWrapper };
