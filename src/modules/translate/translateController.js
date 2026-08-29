const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const { RESPONSE_STATUS, TRANSLATE_MESSAGES } = require("../../constants");

class TranslateController {
    constructor(translateService, logger) {
        this.translateService = translateService;
        this.logger = logger;
    }

    async translate(req, res, next) {
        const { q, source, target } = req.body;

        const logContext = {
            requestId: req.requestId,
            userId: req.user ? String(req.user._id) : null,
            count: Array.isArray(q) ? q.length : null,
            source,
            target,
        };

        this.logger.info("Request to translate texts", logContext);

        if (!q) {
            this.logger.warn("Translate request is missing q", logContext);
            return next(createHttpError(400, TRANSLATE_MESSAGES.Q_REQUIRED));
        }

        if (!Array.isArray(q) || q.length === 0) {
            this.logger.warn(
                "Translate request q is not a non-empty array",
                logContext,
            );
            return next(createHttpError(400, TRANSLATE_MESSAGES.Q_NOT_ARRAY));
        }

        if (!source) {
            this.logger.warn("Translate request is missing source", logContext);
            return next(
                createHttpError(400, TRANSLATE_MESSAGES.SOURCE_REQUIRED),
            );
        }

        if (!target) {
            this.logger.warn("Translate request is missing target", logContext);
            return next(
                createHttpError(400, TRANSLATE_MESSAGES.TARGET_REQUIRED),
            );
        }

        const translatedTexts = await this.translateService.translateTexts(
            q,
            source,
            target,
        );

        this.logger.info("Texts translated", logContext);

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: TRANSLATE_MESSAGES.TRANSLATED,
            data: {
                translatedTexts,
            },
        });
    }
}

module.exports = { TranslateController };
