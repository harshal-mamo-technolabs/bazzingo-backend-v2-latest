const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    PRICE_CATALOG_MESSAGES,
    PRICE_CATALOG_DEFAULTS,
} = require("../../constants");

class PriceCatalogController {
    constructor(priceCatalogService, logger) {
        this.priceCatalogService = priceCatalogService;
        this.logger = logger;
    }

    async createPriceCatalog(req, res, next) {
        const {
            assessmentId,
            planId,
            stripePriceId,
            stripeProductId,
            type,
            lookupKey,
            currency = PRICE_CATALOG_DEFAULTS.CURRENCY,
            unitAmount,
            active = true,
            default: isDefault = false,
            productDuration = PRICE_CATALOG_DEFAULTS.PRODUCT_DURATION,
            metadata = {},
        } = req.body;

        this.logger.info("Request to create a price catalog entry", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            stripePriceId,
            type,
        });

        if (!stripePriceId) {
            this.logger.warn("Price catalog creation failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(
                createHttpError(
                    400,
                    PRICE_CATALOG_MESSAGES.STRIPE_PRICE_ID_REQUIRED,
                ),
            );
        }

        if (!stripeProductId) {
            this.logger.warn("Price catalog creation failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(
                createHttpError(
                    400,
                    PRICE_CATALOG_MESSAGES.STRIPE_PRODUCT_ID_REQUIRED,
                ),
            );
        }

        if (!type) {
            this.logger.warn("Price catalog creation failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(
                createHttpError(400, PRICE_CATALOG_MESSAGES.TYPE_REQUIRED),
            );
        }

        if (typeof unitAmount !== "number") {
            this.logger.warn("Price catalog creation failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(
                createHttpError(
                    400,
                    PRICE_CATALOG_MESSAGES.UNIT_AMOUNT_REQUIRED,
                ),
            );
        }

        const price = await this.priceCatalogService.create({
            assessmentId,
            planId,
            stripePriceId,
            stripeProductId,
            type,
            lookupKey,
            currency,
            unitAmount,
            active,
            isDefault,
            productDuration,
            metadata,
        });

        this.logger.info("Price catalog entry created", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            priceId: String(price._id),
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: PRICE_CATALOG_MESSAGES.CREATED,
            data: { price },
        });
    }
}

module.exports = { PriceCatalogController };
