const { ORDER_STATUSES } = require("../../constants");
const Order = require("./orderModel");

class OrderService {
    constructor(logger) {
        this.logger = logger;
    }

    async findSucceededAssessmentOrders(userId) {
        this.logger.info("Reading the succeeded assessment orders", {
            userId: String(userId),
        });

        return await Order.find({
            userId,
            status: ORDER_STATUSES.SUCCEEDED,
            assessmentId: { $exists: true, $ne: null },
        })
            .select("assessmentId")
            .lean();
    }

    async findPurchasedAssessmentIds(userId) {
        const orders = await this.findSucceededAssessmentOrders(userId);

        return [
            ...new Set(
                orders.map((order) => order.assessmentId).filter(Boolean),
            ),
        ];
    }

    async findSucceededOrdersWithAssessment(userId) {
        this.logger.info("Reading the populated assessment orders", {
            userId: String(userId),
        });

        return await Order.find({
            userId,
            status: ORDER_STATUSES.SUCCEEDED,
            assessmentId: { $exists: true },
        })
            .populate("assessmentId")
            .lean();
    }
}

module.exports = { OrderService };
