const {
    parseFlowId,
    parseUtmParams,
    realUtmValue,
    UTM_DEFAULT,
} = require("../utils/utmParams");
const { asyncWrapper } = require("../utils/wrapper");
const LandingPageHook = require("../../modules/lp/landingPageHookModel");

// A purchase takes the campaign/medium it arrived with: the request's own UTMs,
// else the landing page hook it came from; with neither it is organic.
const resolvePurchaseTouch = async (req) => {
    const body = req.body || {};
    const touch = parseUtmParams(body);
    if (
        touch.utmCampaign !== UTM_DEFAULT ||
        touch.utmMedium !== UTM_DEFAULT ||
        !body.hookUuid
    ) {
        return touch;
    }

    const hook = await LandingPageHook.findOne({
        uuid: String(body.hookUuid),
        email: String(req.user.email).toLowerCase(),
    })
        .select("utmCampaign utmMedium")
        .lean();
    return hook || touch;
};

// Capture a direct checkout link before Stripe objects take their snapshot.
module.exports = asyncWrapper(async (req, res, next) => {
    const flowId = parseFlowId(req.body);
    const { utmCampaign, utmMedium } = await resolvePurchaseTouch(req);
    req.user.$locals.purchaseAttribution = {
        flowId,
        utmEmail:
            realUtmValue(req.body?.utm_email ?? req.body?.utmEmail) ??
            (flowId ? "Klaviyo" : undefined),
        utmCampaign,
        utmMedium,
    };
    next();
});
