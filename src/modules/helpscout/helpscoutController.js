const createHttpError = require("http-errors");
const { config } = require("../../config");
const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    HELPSCOUT_MESSAGES,
    HELPSCOUT_API,
} = require("../../constants");
const {
    renderHelpScoutProfileSidebarPage,
} = require("./helpscoutSidebarTemplate");

class HelpscoutController {
    constructor(helpscoutService, klaviyoService, logger) {
        this.helpscoutService = helpscoutService;
        this.klaviyoService = klaviyoService;
        this.logger = logger;
    }

    renderProfileSidebar(req, res) {
        this.logger.info("Request to render the Help Scout sidebar", {
            requestId: req.requestId,
        });

        const apiToken =
            config.HELP_SCOUT_APP_SECRET || config.HELP_SCOUT_SECRET;

        if (!apiToken) {
            this.logger.error("Help Scout sidebar secret is not configured", {
                requestId: req.requestId,
            });

            return res
                .status(500)
                .type("html")
                .send(HELPSCOUT_MESSAGES.MISCONFIGURED_PAGE);
        }

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");

        this.logger.info("Help Scout sidebar rendered", {
            requestId: req.requestId,
        });

        return res.send(renderHelpScoutProfileSidebarPage(apiToken));
    }

    async getUserSignature(req, res) {
        this.logger.info("Request for a Help Scout signature", {
            requestId: req.requestId,
            userId: String(req.user._id),
        });

        try {
            const { signature, payload, expiresAt } =
                this.helpscoutService.generateSignature(req.user);

            this.logger.info("Help Scout signature sent", {
                requestId: req.requestId,
                userId: String(req.user._id),
                expiresAt,
            });

            return sendResponse(res, {
                statusCode: 200,
                status: RESPONSE_STATUS.SUCCESS,
                message: HELPSCOUT_MESSAGES.SIGNATURE_GENERATED,
                data: {
                    signature,
                    expiresAt,
                    user: payload,
                    properties: payload.properties || {},
                },
            });
        } catch (error) {
            this.logger.error("Failed to generate a Help Scout signature", {
                requestId: req.requestId,
                userId: String(req.user._id),
                error: error.message,
            });
            throw error;
        }
    }

    async getKlaviyoProfile(req, res, next) {
        this.logger.info("Request for a Klaviyo profile from Help Scout", {
            requestId: req.requestId,
        });

        const raw = req.query.email;

        if (raw === undefined || raw === null || String(raw).trim() === "") {
            this.logger.warn("Klaviyo profile request without an email", {
                requestId: req.requestId,
            });

            return next(
                createHttpError(400, HELPSCOUT_MESSAGES.EMAIL_QUERY_REQUIRED),
            );
        }

        const email = String(raw).trim();

        if (!HELPSCOUT_API.EMAIL_PATTERN.test(email)) {
            this.logger.warn("Klaviyo profile request with an invalid email", {
                requestId: req.requestId,
            });

            return next(createHttpError(400, HELPSCOUT_MESSAGES.INVALID_EMAIL));
        }

        let result;

        try {
            result = await this.klaviyoService.getProfileByEmail(email);
        } catch (error) {
            this.logger.error("Klaviyo profile fetch failed", {
                requestId: req.requestId,
                statusCode: error.statusCode,
                error: error.message,
            });

            return next(
                createHttpError(502, HELPSCOUT_MESSAGES.KLAVIYO_PROFILE_FAILED),
            );
        }

        if (result.skipped) {
            this.logger.error("Klaviyo integration is not configured", {
                requestId: req.requestId,
            });

            return next(
                createHttpError(503, HELPSCOUT_MESSAGES.KLAVIYO_NOT_CONFIGURED),
            );
        }

        this.logger.info("Klaviyo profile sent to Help Scout", {
            requestId: req.requestId,
            found: Boolean(result.profile),
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: result.profile
                ? HELPSCOUT_MESSAGES.KLAVIYO_PROFILE_FOUND
                : HELPSCOUT_MESSAGES.KLAVIYO_PROFILE_ABSENT,
            data: {
                email: email.toLowerCase(),
                profile: result.profile,
            },
        });
    }
}

module.exports = { HelpscoutController };
