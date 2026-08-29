const UTM_DEFAULT = "default";

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

        return value === "" ? UTM_DEFAULT : value;
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

    return trimmed === "" || trimmed.toLowerCase() === UTM_DEFAULT
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

    if (!record.utmSource) record.utmSource = UTM_DEFAULT;
    if (!record.utmCampaign) record.utmCampaign = UTM_DEFAULT;
    if (!record.utmMedium) record.utmMedium = UTM_DEFAULT;

    return record;
};

const applyUtmToRecord = (record, parsed) => {
    if (parsed.utmSource !== undefined) record.utmSource = parsed.utmSource;
    if (parsed.utmCampaign !== undefined)
        record.utmCampaign = parsed.utmCampaign;
    if (parsed.utmMedium !== undefined) record.utmMedium = parsed.utmMedium;

    return ensureUtmDefaults(record);
};

module.exports = {
    parseUtmParams,
    ensureUtmDefaults,
    applyUtmToRecord,
    realUtmValue,
    hasRealUtm,
    UTM_DEFAULT,
};
