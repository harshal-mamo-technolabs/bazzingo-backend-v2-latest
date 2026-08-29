const { config } = require("../../config");
const {
    KLAVIYO_MESSAGES,
    KLAVIYO_RESOURCES,
    KLAVIYO_PROXY,
    KLAVIYO_API,
} = require("../../constants");
const KlaviyoBackup = require("./klaviyoBackupModel");

const parseBody = (text) => {
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
};

const upstreamError = (prefix, response, data, text) => {
    const detail =
        data?.errors?.[0]?.detail ||
        data?.message ||
        text ||
        KLAVIYO_MESSAGES.UNKNOWN_ERROR;
    const error = new Error(
        `${prefix} ${response.status} ${response.statusText}: ${detail}`,
    );

    error.statusCode = response.status;
    error.response = data;

    return error;
};

const sanitizeProperties = (properties) => {
    if (!properties || typeof properties !== "object") {
        return {};
    }

    return Object.fromEntries(
        Object.entries(properties).filter(([, value]) => value !== undefined),
    );
};

const normalizeEmail = (email) =>
    typeof email === "string" && email.trim()
        ? email.trim().toLowerCase()
        : null;

const splitName = (name) => {
    if (!name || typeof name !== "string") {
        return { firstName: undefined, lastName: undefined };
    }

    const parts = name.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
        return { firstName: undefined, lastName: undefined };
    }

    if (parts.length === 1) {
        return { firstName: parts[0], lastName: undefined };
    }

    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

const buildEmailEqualsFilter = (email) =>
    `equals(email,"${String(email).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;

const mapProfileRecord = (item) => {
    if (!item || item.type !== KLAVIYO_API.PROFILE_TYPE) {
        return null;
    }

    const attributes = item.attributes || {};

    return {
        id: item.id,
        email: attributes.email,
        firstName: attributes.first_name,
        lastName: attributes.last_name,
        phoneNumber: attributes.phone_number,
        externalId: attributes.external_id,
        title: attributes.title,
        organization: attributes.organization,
        locale: attributes.locale,
        image: attributes.image,
        created: attributes.created,
        updated: attributes.updated,
        location: attributes.location,
        properties:
            attributes.properties && typeof attributes.properties === "object"
                ? attributes.properties
                : {},
    };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class KlaviyoService {
    constructor(logger, httpClient = (...args) => globalThis.fetch(...args)) {
        this.logger = logger;
        this.httpClient = httpClient;
    }

    isConfigured() {
        return Boolean(
            config.KLAVIYO_PRIVATE_API_KEY && config.KLAVIYO_API_BASE_URL,
        );
    }

    async request(url, { method, body, timeoutMs }) {
        if (!this.isConfigured()) {
            this.logger.warn(
                "Klaviyo credentials missing, skipping Klaviyo call",
                { url },
            );

            return { skipped: true, reason: KLAVIYO_MESSAGES.ENV_MISSING };
        }

        this.logger.info("Calling the Klaviyo API", { method, url });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await this.httpClient(url, {
                method,
                headers: {
                    Authorization: `Klaviyo-API-Key ${config.KLAVIYO_PRIVATE_API_KEY}`,
                    "Content-Type": "application/json",
                    revision: config.KLAVIYO_REVISION,
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: controller.signal,
            });
            const text = await response.text();
            const data = parseBody(text);

            if (!response.ok) {
                throw upstreamError(
                    KLAVIYO_API.ERROR_PREFIX,
                    response,
                    data,
                    text,
                );
            }

            this.logger.info("Klaviyo API call succeeded", {
                method,
                url,
                status: response.status,
            });

            return { ok: true, status: response.status, data };
        } catch (error) {
            this.logger.error("Klaviyo API call failed", {
                method,
                url,
                statusCode: error.statusCode,
                error: error.message,
            });
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    async fetchPage(url, headers) {
        for (
            let attempt = 0;
            attempt <= KLAVIYO_PROXY.MAX_RETRIES_PER_PAGE;
            attempt += 1
        ) {
            const controller = new AbortController();
            const timer = setTimeout(
                () => controller.abort(),
                KLAVIYO_PROXY.REQUEST_TIMEOUT_MS,
            );
            let response;

            try {
                response = await this.httpClient(url, {
                    method: "GET",
                    headers,
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }

            if (
                response.status === KLAVIYO_PROXY.RATE_LIMITED_STATUS &&
                attempt < KLAVIYO_PROXY.MAX_RETRIES_PER_PAGE
            ) {
                const retryAfter = Number(response.headers.get("Retry-After"));
                const waitMs =
                    Number.isFinite(retryAfter) && retryAfter > 0
                        ? retryAfter * 1000
                        : 2 ** attempt * 1000;

                this.logger.warn("Klaviyo rate limited the proxy request", {
                    url,
                    waitMs,
                    attempt: attempt + 1,
                });
                await delay(waitMs);
                continue;
            }

            const text = await response.text();
            const data = parseBody(text);

            if (!response.ok) {
                const error = upstreamError(
                    KLAVIYO_PROXY.ERROR_PREFIX,
                    response,
                    data,
                    text,
                );

                this.logger.error("Klaviyo proxy page failed", {
                    url,
                    statusCode: error.statusCode,
                    error: error.message,
                });
                throw error;
            }

            return data;
        }

        const error = new Error(KLAVIYO_MESSAGES.RATE_LIMIT_EXCEEDED);

        error.statusCode = KLAVIYO_PROXY.RATE_LIMITED_STATUS;
        this.logger.error("Klaviyo proxy retries exhausted", { url });
        throw error;
    }

    buildInitialUrl(resource, pageSize) {
        const base = (
            config.KLAVIYO_API_BASE_URL || KLAVIYO_PROXY.DEFAULT_API_BASE_URL
        ).replace(/\/+$/, "");
        const params = new URLSearchParams();

        if (resource.pageSizeParam && pageSize != null) {
            params.set("page[size]", String(pageSize));
        }

        const query = params.toString();

        return query
            ? `${base}/${resource.path}?${query}`
            : `${base}/${resource.path}`;
    }

    resolvePageSize(resource, pageSize) {
        if (!resource.pageSizeParam) {
            return resource.defaultPageSize;
        }

        const parsed = Number.parseInt(pageSize, 10);
        const resolved =
            Number.isFinite(parsed) && parsed >= 1
                ? parsed
                : resource.defaultPageSize;

        return resolved > resource.maxPageSize
            ? resource.maxPageSize
            : resolved;
    }

    async fetchAllResource(resource, { apiKey, revision, pageSize } = {}) {
        this.logger.info("Fetching every Klaviyo record for a resource", {
            resource: resource.label,
        });

        const headers = {
            Authorization: `Klaviyo-API-Key ${apiKey.trim()}`,
            "Content-Type": "application/json",
            revision:
                (revision && String(revision).trim()) ||
                KLAVIYO_PROXY.DEFAULT_REVISION,
        };

        let nextUrl = this.buildInitialUrl(
            resource,
            this.resolvePageSize(resource, pageSize),
        );
        const allData = [];
        const allIncluded = [];
        const seenUrls = new Set();
        let lastResponse = null;
        let pageCount = 0;

        while (nextUrl) {
            if (pageCount >= KLAVIYO_PROXY.MAX_PAGES) {
                this.logger.warn("Klaviyo pagination hit the page ceiling", {
                    resource: resource.label,
                    maxPages: KLAVIYO_PROXY.MAX_PAGES,
                });
                break;
            }

            if (seenUrls.has(nextUrl)) {
                this.logger.warn("Klaviyo repeated a pagination cursor", {
                    resource: resource.label,
                    url: nextUrl,
                });
                break;
            }

            seenUrls.add(nextUrl);

            const page = await this.fetchPage(nextUrl, headers);

            pageCount += 1;
            lastResponse = page;

            if (Array.isArray(page?.data)) {
                allData.push(...page.data);
            }

            if (Array.isArray(page?.included)) {
                allIncluded.push(...page.included);
            }

            const next = page?.links?.next;

            nextUrl = typeof next === "string" && next.length > 0 ? next : null;
        }

        const combined = {
            data: allData,
            links: {
                ...(lastResponse?.links &&
                typeof lastResponse.links === "object"
                    ? lastResponse.links
                    : {}),
                next: null,
                prev: null,
            },
        };

        if (lastResponse?.meta && typeof lastResponse.meta === "object") {
            combined.meta = lastResponse.meta;
        }

        if (allIncluded.length > 0) {
            combined.included = allIncluded;
        }

        this.logger.info("Fetched every Klaviyo record for a resource", {
            resource: resource.label,
            pageCount,
            total: allData.length,
        });

        return { data: combined, pageCount, total: allData.length };
    }

    async fetchAllProfiles(options) {
        const { data, pageCount, total } = await this.fetchAllResource(
            KLAVIYO_RESOURCES.PROFILES,
            options,
        );

        return { profiles: data, pageCount, total };
    }

    async fetchAllEvents(options) {
        const { data, pageCount, total } = await this.fetchAllResource(
            KLAVIYO_RESOURCES.EVENTS,
            options,
        );

        return { events: data, pageCount, total };
    }

    async fetchAllMetrics(options) {
        const { data, pageCount, total } = await this.fetchAllResource(
            KLAVIYO_RESOURCES.METRICS,
            options,
        );

        return { metrics: data, pageCount, total };
    }

    async getProfileByEmail(email) {
        const safeEmail = normalizeEmail(email);

        this.logger.info("Reading a Klaviyo profile by email", {
            hasEmail: Boolean(safeEmail),
        });

        if (!safeEmail) {
            this.logger.warn("Klaviyo profile lookup skipped, email missing");

            return { skipped: false, profile: null };
        }

        const params = new URLSearchParams({
            filter: buildEmailEqualsFilter(safeEmail),
            "page[size]": "1",
        });
        const result = await this.request(
            `${config.KLAVIYO_API_BASE_URL}${KLAVIYO_API.PROFILES_PATH}?${params.toString()}`,
            { method: "GET", timeoutMs: KLAVIYO_API.GET_TIMEOUT_MS },
        );

        if (result.skipped) {
            return { skipped: true, reason: result.reason, profile: null };
        }

        const profile = mapProfileRecord(result.data?.data?.[0]);

        this.logger.info("Read a Klaviyo profile by email", {
            found: Boolean(profile),
        });

        return { skipped: false, profile };
    }

    async saveBackup({ email, firstName, lastName, properties }) {
        this.logger.info("Mirroring a Klaviyo profile into the backup", {
            email,
        });

        const existing = await KlaviyoBackup.findOne({ email }).lean();
        const mergedProperties =
            existing?.properties &&
            typeof existing.properties === "object" &&
            !Array.isArray(existing.properties)
                ? { ...existing.properties, ...properties }
                : { ...properties };
        const update = { email, properties: mergedProperties };

        if (firstName) {
            update.firstName = firstName;
        }

        if (lastName) {
            update.lastName = lastName;
        }

        await KlaviyoBackup.findOneAndUpdate(
            { email },
            { $set: update },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        this.logger.info("Mirrored a Klaviyo profile into the backup", {
            email,
        });
    }

    async upsertProfileByEmail({ email, name, properties }) {
        const safeEmail = normalizeEmail(email);

        this.logger.info("Upserting a Klaviyo profile", {
            hasEmail: Boolean(safeEmail),
        });

        if (!safeEmail) {
            this.logger.warn("Klaviyo profile upsert skipped, email missing");

            return { skipped: true, reason: KLAVIYO_MESSAGES.EMAIL_MISSING };
        }

        const { firstName, lastName } = splitName(name);
        const safeProperties = sanitizeProperties(properties);

        safeProperties[KLAVIYO_API.BAZZINGO_PROPERTY] = true;

        try {
            await this.saveBackup({
                email: safeEmail,
                firstName,
                lastName,
                properties: safeProperties,
            });
        } catch (error) {
            this.logger.error("Failed to save the Klaviyo profile backup", {
                email: safeEmail,
                error: error.message,
            });
        }

        return await this.request(
            `${config.KLAVIYO_API_BASE_URL}${KLAVIYO_API.PROFILE_IMPORT_PATH}`,
            {
                method: "POST",
                timeoutMs: KLAVIYO_API.POST_TIMEOUT_MS,
                body: {
                    data: {
                        type: KLAVIYO_API.PROFILE_TYPE,
                        attributes: {
                            email: safeEmail,
                            ...(firstName ? { first_name: firstName } : {}),
                            ...(lastName ? { last_name: lastName } : {}),
                            properties: safeProperties,
                        },
                    },
                },
            },
        );
    }

    async createEvent({ email, metricName, properties, uniqueId, timeISO }) {
        const safeEmail = normalizeEmail(email);

        this.logger.info("Creating a Klaviyo event", {
            metricName,
            hasEmail: Boolean(safeEmail),
        });

        if (!safeEmail) {
            this.logger.warn("Klaviyo event skipped, email missing", {
                metricName,
            });

            return { skipped: true, reason: KLAVIYO_MESSAGES.EMAIL_MISSING };
        }

        if (!metricName) {
            this.logger.warn("Klaviyo event skipped, metric name missing", {
                email: safeEmail,
            });

            return {
                skipped: true,
                reason: KLAVIYO_MESSAGES.METRIC_NAME_MISSING,
            };
        }

        const safeProperties = sanitizeProperties(properties);

        if (Object.keys(safeProperties).length === 0) {
            safeProperties.action = metricName;
        }

        return await this.request(
            `${config.KLAVIYO_API_BASE_URL}${KLAVIYO_API.EVENTS_PATH}`,
            {
                method: "POST",
                timeoutMs: KLAVIYO_API.POST_TIMEOUT_MS,
                body: {
                    data: {
                        type: KLAVIYO_API.EVENT_TYPE,
                        attributes: {
                            properties: safeProperties,
                            metric: {
                                data: {
                                    type: KLAVIYO_API.METRIC_TYPE,
                                    attributes: { name: metricName },
                                },
                            },
                            profile: {
                                data: {
                                    type: KLAVIYO_API.PROFILE_TYPE,
                                    attributes: { email: safeEmail },
                                },
                            },
                            unique_id: uniqueId,
                            ...(timeISO ? { time: timeISO } : {}),
                        },
                    },
                },
            },
        );
    }
}

module.exports = { KlaviyoService };
