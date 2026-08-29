const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const {
    RESPONSE_STATUS,
    PLAN_MESSAGES,
    PLAN_PRICE_TYPES,
    PLAN_DEFAULT_INTERVAL_COUNT,
} = require("../../constants");

class PlanController {
    constructor(planService, logger) {
        this.planService = planService;
        this.logger = logger;
    }

    async createPlan(req, res, next) {
        const { name, description = "", metadata = {} } = req.body;

        this.logger.info("Request to create a plan", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            name,
        });

        if (!name?.trim()) {
            this.logger.warn("Plan creation failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(createHttpError(400, PLAN_MESSAGES.NAME_REQUIRED));
        }

        try {
            const { plan, stripeProductId } =
                await this.planService.createWithStripeProduct({
                    name,
                    description,
                    metadata,
                });

            this.logger.info("Plan created", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
                planId: String(plan._id),
            });

            return sendResponse(res, {
                statusCode: 201,
                status: RESPONSE_STATUS.SUCCESS,
                message: PLAN_MESSAGES.CREATED,
                data: { plan, stripeProductId },
            });
        } catch (error) {
            this.logger.error("Plan creation failed", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
                reason: error.message,
            });

            await this.planService.deactivateStripeProduct(
                error.stripeProductId,
            );

            return next(
                createHttpError(
                    error.statusCode || 500,
                    error.message || PLAN_MESSAGES.CREATE_FAILED,
                ),
            );
        }
    }

    async listPlans(req, res) {
        this.logger.info("Request to list the plans", {
            requestId: req.requestId,
        });

        const plans = await this.planService.listWithPrices();

        this.logger.info("Plans listed", {
            requestId: req.requestId,
            count: plans.length,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: PLAN_MESSAGES.LISTED,
            data: { plans },
        });
    }

    async attachPlanPrices(req, res, next) {
        const {
            planId,
            monthlyPriceId,
            monthlyIntervalCount = PLAN_DEFAULT_INTERVAL_COUNT,
            yearlyPriceId,
            yearlyIntervalCount = PLAN_DEFAULT_INTERVAL_COUNT,
            trialPriceId,
        } = req.body;

        this.logger.info("Request to attach plan prices", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            planId,
        });

        if (!planId) {
            this.logger.warn("Plan price attachment failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(createHttpError(400, PLAN_MESSAGES.PLAN_ID_REQUIRED));
        }

        const plan = await this.planService.findById(planId);

        if (!plan) {
            return next(createHttpError(404, PLAN_MESSAGES.NOT_FOUND));
        }

        const populated = await this.planService.attachPrices(plan, {
            monthlyPriceId,
            monthlyIntervalCount,
            yearlyPriceId,
            yearlyIntervalCount,
            trialPriceId,
        });

        this.logger.info("Plan prices attached", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            planId,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: PLAN_MESSAGES.PRICES_UPDATED,
            data: { plan: populated },
        });
    }

    async createDirectPlan(req, res, next) {
        const {
            name,
            description = "",
            stripeProductId,
            prices = {},
            active = true,
        } = req.body;

        this.logger.info("Request to create a plan directly", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            name,
        });

        if (!name) {
            this.logger.warn("Direct plan creation failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(createHttpError(400, PLAN_MESSAGES.NAME_REQUIRED));
        }

        if (!stripeProductId) {
            this.logger.warn("Direct plan creation failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
            });

            return next(
                createHttpError(400, PLAN_MESSAGES.STRIPE_PRODUCT_ID_REQUIRED),
            );
        }

        const plan = await this.planService.createDirect({
            name,
            description,
            stripeProductId,
            prices,
            active,
        });

        this.logger.info("Plan created directly", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            planId: String(plan._id),
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: PLAN_MESSAGES.DIRECT_CREATED,
            data: { plan },
        });
    }

    async attachPriceToPlan(req, res, next) {
        const { planId } = req.params;
        const {
            priceType,
            priceId,
            intervalCount = PLAN_DEFAULT_INTERVAL_COUNT,
        } = req.body;

        this.logger.info("Request to attach a price to a plan", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            planId,
            priceType,
        });

        if (!planId) {
            return next(createHttpError(400, PLAN_MESSAGES.PLAN_ID_REQUIRED));
        }

        if (!priceType) {
            return next(
                createHttpError(400, PLAN_MESSAGES.PRICE_TYPE_REQUIRED),
            );
        }

        if (!priceId) {
            return next(createHttpError(400, PLAN_MESSAGES.PRICE_ID_REQUIRED));
        }

        if (!Object.values(PLAN_PRICE_TYPES).includes(priceType)) {
            this.logger.warn("Price attachment failed validation", {
                requestId: req.requestId,
                adminId: String(req.admin._id),
                priceType,
            });

            return next(createHttpError(400, PLAN_MESSAGES.INVALID_PRICE_TYPE));
        }

        if (priceType !== PLAN_PRICE_TYPES.TRIAL) {
            const validIntervalCount =
                Number.isFinite(intervalCount) &&
                parseInt(intervalCount, 10) >= PLAN_DEFAULT_INTERVAL_COUNT;

            if (!validIntervalCount) {
                this.logger.warn("Price attachment failed validation", {
                    requestId: req.requestId,
                    adminId: String(req.admin._id),
                    intervalCount,
                });

                return next(
                    createHttpError(400, PLAN_MESSAGES.INVALID_INTERVAL_COUNT),
                );
            }
        }

        const plan = await this.planService.findById(planId);

        if (!plan) {
            return next(createHttpError(404, PLAN_MESSAGES.NOT_FOUND));
        }

        const priceCatalog = await this.planService.findPriceInCatalog(priceId);

        if (!priceCatalog) {
            return next(createHttpError(404, PLAN_MESSAGES.PRICE_NOT_FOUND));
        }

        const populated = await this.planService.attachPrice(plan, {
            priceType,
            priceId,
            intervalCount,
        });

        this.logger.info("Price attached to the plan", {
            requestId: req.requestId,
            adminId: String(req.admin._id),
            planId,
            priceType,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: PLAN_MESSAGES.PRICE_ATTACHED,
            data: {
                plan: populated,
                attachedPrice: {
                    type: priceType,
                    priceId,
                    intervalCount:
                        priceType === PLAN_PRICE_TYPES.TRIAL
                            ? undefined
                            : parseInt(intervalCount, 10),
                },
            },
        });
    }
}

module.exports = { PlanController };
