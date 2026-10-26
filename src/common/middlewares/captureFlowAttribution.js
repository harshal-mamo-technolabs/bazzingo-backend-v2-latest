const { parseFlowId, realUtmValue } = require("../utils/utmParams");
const { asyncWrapper } = require("../utils/wrapper");

// Capture a direct checkout link before Stripe objects take their snapshot.
module.exports = asyncWrapper(async (req, res, next) => {
    const flowId = parseFlowId(req.body);
    req.user.$locals.purchaseAttribution = {
        flowId,
        utmEmail:
            realUtmValue(req.body?.utm_email ?? req.body?.utmEmail) ??
            (flowId ? "Klaviyo" : undefined),
    };
    next();
});
