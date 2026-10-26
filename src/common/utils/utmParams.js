const createHttpError = require("http-errors");
const UTM_DEFAULT = "organic";
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

const realUtmValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }

    const trimmed = String(value).trim();

    return trimmed === "" || trimmed.toLowerCase() === "default"
        ? null
        : trimmed;
};

const hasRealUtm = (record) =>
    Boolean(
        record &&
        (realUtmValue(record.utmSource) !== null ||
            realUtmValue(record.utmCampaign) !== null ||
            realUtmValue(record.utmMedium) !== null),
    );

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

const buildPurchaseAttributionMetadata = (user) => {
    const attribution = user?.$locals?.purchaseAttribution;
    return {
        ...(attribution?.flowId ? { flow_id: attribution.flowId } : {}),
        ...(attribution?.utmEmail ? { utm_email: attribution.utmEmail } : {}),
    };
};

const applyUtmToRecord = (record, parsed) => {
    for (const field of UTM_FIELDS) {
        if (
            realUtmValue(record[field]) === null &&
            parsed[field] !== undefined
        ) {
            record[field] = parsed[field];
        }
    }

    return ensureUtmDefaults(record);
};

module.exports = {
    parseUtmParams,
    ensureUtmDefaults,
    applyUtmToRecord,
    realUtmValue,
    hasRealUtm,
    UTM_DEFAULT,
    persistUtmDefaults,
    buildUtmMetadata,
    buildPurchaseAttributionMetadata,
    parseFlowId,
};
