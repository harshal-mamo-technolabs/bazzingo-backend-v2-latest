const createHttpError = require("http-errors");
const { config } = require("../../config");
const UTM_DEFAULT = config.UTM_DEFAULT_VALUE;
const UTM_FIELDS = ["utmSource", "utmCampaign", "utmMedium"];

const parseFlowId = (params = {}) => {
    const value =
        params.flowId ??
        params.flow_id ??
        params.klaviyo_flow_id ??
        params.utm_id;
    if (value === undefined || value === null || value === "") return undefined;
    if (
        typeof value !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(value.trim())
    ) {
        throw createHttpError(400, "Invalid Klaviyo flow ID");
    }
    return value.trim();
};

const parseUtmParams = (body = {}, { onlyProvided = false } = {}) => {
    const pick = (camel, snake) => {
        const hasCamel = Object.prototype.hasOwnProperty.call(body, camel);
        const hasSnake = Object.prototype.hasOwnProperty.call(body, snake);

        if (onlyProvided && !hasCamel && !hasSnake) {
            return undefined;
        }

        const raw = body[camel] ?? body[snake];

        if (raw === undefined || raw === null) {
            return UTM_DEFAULT;
        }

        const value = String(raw).trim();

        return realUtmValue(value) ?? UTM_DEFAULT;
    };

    const parsed = {
        utmSource: pick("utmSource", "utm_source"),
        utmCampaign: pick("utmCampaign", "utm_campaign"),
        utmMedium: pick("utmMedium", "utm_medium"),
    };

    return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value !== undefined),
    );
};

// A campaign touch is a visit that carried its own utm_source or utm_campaign.
const parseUtmTouch = (params = {}) => {
    const parsed = parseUtmParams(params);
    return parsed.utmSource !== UTM_DEFAULT || parsed.utmCampaign !== UTM_DEFAULT
        ? parsed
        : null;
};

// Once the email is known its source is locked, so only campaign/medium mark a new touch.
const isNewTouch = (record, touch) =>
    Boolean(touch) &&
    (record.email ? ["utmCampaign", "utmMedium"] : UTM_FIELDS).some(
        (field) => record[field] !== touch[field],
    );

const realUtmValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }

    const trimmed = String(value).trim();

    return trimmed === "" || trimmed.toLowerCase() === "default"
        ? null
        : trimmed;
};

const ensureUtmDefaults = (record) => {
    if (!record) {
        return record;
    }

    for (const field of UTM_FIELDS) {
        record[field] = realUtmValue(record[field]) ?? UTM_DEFAULT;
    }

    return record;
};

const persistUtmDefaults = async (record) => {
    const updates = {};

    for (const field of UTM_FIELDS) {
        if (
            realUtmValue(record[field]) === null ||
            record.$isDefault?.(field)
        ) {
            updates[field] = realUtmValue(record[field]) ?? UTM_DEFAULT;
        }
    }

    if (Object.keys(updates).length) {
        // Repair only missing/legacy placeholders; never replace saved attribution.
        for (const [field, value] of Object.entries(updates)) {
            await record.collection.updateOne(
                {
                    _id: record._id,
                    $or: [
                        { [field]: { $exists: false } },
                        { [field]: null },
                        { [field]: /^\s*(?:default)?\s*$/i },
                    ],
                },
                { $set: { [field]: value } },
            );
        }
        const stored = await record.collection.findOne(
            { _id: record._id },
            { projection: { utmSource: 1, utmCampaign: 1, utmMedium: 1 } },
        );
        for (const field of UTM_FIELDS) {
            record.set(
                field,
                realUtmValue(stored?.[field]) ?? UTM_DEFAULT,
                undefined,
                {
                    overwriteImmutable: true,
                },
            );
        }
    }
};

const buildUtmMetadata = (user) => ({
    utm_source: realUtmValue(user?.utmSource) ?? UTM_DEFAULT,
    utm_campaign: realUtmValue(user?.utmCampaign) ?? UTM_DEFAULT,
    utm_medium: realUtmValue(user?.utmMedium) ?? UTM_DEFAULT,
});

// A purchase keeps the locked source; campaign/medium come from the purchase's own
// touch (set on $locals.purchaseAttribution) and are organic without one.
const buildPurchaseAttributionMetadata = (user) => {
    const attribution = user?.$locals?.purchaseAttribution;
    return {
        utm_source: realUtmValue(user?.utmSource) ?? UTM_DEFAULT,
        utm_campaign: realUtmValue(attribution?.utmCampaign) ?? UTM_DEFAULT,
        utm_medium: realUtmValue(attribution?.utmMedium) ?? UTM_DEFAULT,
        ...(attribution?.flowId ? { flow_id: attribution.flowId } : {}),
        ...(attribution?.utmEmail ? { utm_email: attribution.utmEmail } : {}),
    };
};

module.exports = {
    parseUtmParams,
    ensureUtmDefaults,
    realUtmValue,
    parseUtmTouch,
    isNewTouch,
    UTM_DEFAULT,
    persistUtmDefaults,
    buildUtmMetadata,
    buildPurchaseAttributionMetadata,
    parseFlowId,
};
