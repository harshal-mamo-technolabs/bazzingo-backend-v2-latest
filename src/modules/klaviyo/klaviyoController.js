const createHttpError = require("http-errors");
const { KLAVIYO_MESSAGES, KLAVIYO_PROXY } = require("../../constants");

const readApiKey = (req) => {
    const apiKey = req.query["klaviyo-api-key"];

    return typeof apiKey === "string" && apiKey.trim() ? apiKey : null;
};

const toHttpError = (error, fallbackMessage) => {
    if (createHttpError.isHttpError(error)) {
        return error;
    }

    const statusCode =
        typeof error?.statusCode === "number" &&
        error.statusCode >= 400 &&
        error.statusCode < 600
            ? error.statusCode
            : KLAVIYO_PROXY.UPSTREAM_ERROR_STATUS;

    return createHttpError(statusCode, error?.message || fallbackMessage);
};

class KlaviyoController {
    constructor(klaviyoService, logger) {
        this.klaviyoService = klaviyoService;
        this.logger = logger;
    }

    async proxy(req, res, next, { method, resultKey, failureMessage }) {
        this.logger.info("Request to proxy a Klaviyo collection", {
            requestId: req.requestId,
            resource: resultKey,
        });

        const apiKey = readApiKey(req);

        if (!apiKey) {
            this.logger.warn("Klaviyo proxy request without an api key", {
                requestId: req.requestId,
                resource: resultKey,
            });

            return next(
                createHttpError(400, KLAVIYO_MESSAGES.API_KEY_REQUIRED),
            );
        }

        try {
            const result = await this.klaviyoService[method]({
                apiKey,
                revision: req.query.revision,
                pageSize: req.query.page_size,
            });

            this.logger.info("Klaviyo collection proxied", {
                requestId: req.requestId,
                resource: resultKey,
                total: result.total,
                pageCount: result.pageCount,
            });

            return res.status(200).json(result[resultKey]);
        } catch (error) {
            this.logger.error("Failed to proxy a Klaviyo collection", {
                requestId: req.requestId,
                resource: resultKey,
                error: error.message,
            });

            return next(toHttpError(error, failureMessage));
        }
    }

    async getAllProfiles(req, res, next) {
        return await this.proxy(req, res, next, {
            method: "fetchAllProfiles",
            resultKey: "profiles",
            failureMessage: KLAVIYO_MESSAGES.PROFILES_FETCH_FAILED,
        });
    }

    async getAllEvents(req, res, next) {
        return await this.proxy(req, res, next, {
            method: "fetchAllEvents",
            resultKey: "events",
            failureMessage: KLAVIYO_MESSAGES.EVENTS_FETCH_FAILED,
        });
    }

    async getAllMetrics(req, res, next) {
        return await this.proxy(req, res, next, {
            method: "fetchAllMetrics",
            resultKey: "metrics",
            failureMessage: KLAVIYO_MESSAGES.METRICS_FETCH_FAILED,
        });
    }
}

module.exports = { KlaviyoController };
