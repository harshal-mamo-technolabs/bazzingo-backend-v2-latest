const crypto = require("crypto");
const { config } = require("../../config");
const {
    HELPSCOUT_MESSAGES,
    HELPSCOUT_SKIP_REASONS,
    HELPSCOUT_DEFAULTS,
    HELPSCOUT_API,
} = require("../../constants");

const splitName = (name) => {
    const trimmed = (name || "").trim();

    if (!trimmed) {
        return { firstName: HELPSCOUT_DEFAULTS.FIRST_NAME, lastName: "" };
    }

    const parts = trimmed.split(/\s+/);

    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

const escapeQuery = (value) =>
    value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

class HelpscoutService {
    constructor(logger, httpClient = (...args) => globalThis.fetch(...args)) {
        this.logger = logger;
        this.httpClient = httpClient;
        this.tokenCache = { accessToken: null, expiresAt: 0 };
    }

    buildUtmPropertyEntries(user) {
        // utmEmail (only ever set by the Klaviyo reminder-link resume flow)
        // overrides the original first-touch utmMedium.
        return [
            {
                slug: config.HELP_SCOUT_UTM_SOURCE_SLUG,
                value: user.utmSource || HELPSCOUT_DEFAULTS.UTM_VALUE,
            },
            {
                slug: config.HELP_SCOUT_UTM_CAMPAIGN_SLUG,
                value: user.utmCampaign || HELPSCOUT_DEFAULTS.UTM_VALUE,
            },
            {
                slug: config.HELP_SCOUT_UTM_MEDIUM_SLUG,
                value:
                    user.utmEmail ||
                    user.utmMedium ||
                    HELPSCOUT_DEFAULTS.UTM_VALUE,
            },
        ].filter(
            (entry) => entry.value != null && String(entry.value).trim() !== "",
        );
    }

    buildUtmIdentifyProperties(user) {
        return Object.fromEntries(
            this.buildUtmPropertyEntries(user).map(({ slug, value }) => [
                slug,
                String(value),
            ]),
        );
    }

    buildUserPayload(user) {
        if (!user) {
            this.logger.error("Help Scout signature requested without a user");
            throw new Error(HELPSCOUT_MESSAGES.USER_REQUIRED);
        }

        if (!user.email) {
            this.logger.error("Help Scout signature requested without email", {
                userId: user._id ? String(user._id) : undefined,
            });
            throw new Error(HELPSCOUT_MESSAGES.USER_EMAIL_REQUIRED);
        }

        const normalizedEmail = user.email.trim().toLowerCase();

        return {
            id: user._id ? String(user._id) : undefined,
            email: normalizedEmail,
            name: user.name || normalizedEmail,
            properties: this.buildUtmIdentifyProperties(user),
        };
    }

    generateSignature(user, options = {}) {
        const expiresInSeconds =
            options.expiresInSeconds ??
            HELPSCOUT_DEFAULTS.SIGNATURE_EXPIRES_IN_SECONDS;

        this.logger.info("Generating a Help Scout signature", {
            userId: user?._id ? String(user._id) : undefined,
        });

        if (!config.HELP_SCOUT_SECRET) {
            this.logger.error("HELP_SCOUT_SECRET is not configured");
            throw new Error(HELPSCOUT_MESSAGES.SECRET_NOT_CONFIGURED);
        }

        const payload = this.buildUserPayload(user);
        const signature = crypto
            .createHmac("sha256", config.HELP_SCOUT_SECRET)
            .update(payload.email)
            .digest("base64");
        const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

        this.logger.info("Generated a Help Scout signature", {
            userId: payload.id,
            expiresAt,
        });

        return { signature, payload, expiresAt };
    }

    isMailboxApiConfigured() {
        return Boolean(
            config.HELP_SCOUT_MAILBOX_APP_ID &&
            config.HELP_SCOUT_MAILBOX_APP_SECRET,
        );
    }

    async getAccessToken() {
        const now = Date.now();

        if (
            this.tokenCache.accessToken &&
            this.tokenCache.expiresAt >
                now + HELPSCOUT_DEFAULTS.TOKEN_REFRESH_MARGIN_MS
        ) {
            return this.tokenCache.accessToken;
        }

        this.logger.info("Requesting a Help Scout access token");

        const response = await this.httpClient(
            `${HELPSCOUT_API.BASE_URL}${HELPSCOUT_API.TOKEN_PATH}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    grant_type: "client_credentials",
                    client_id: config.HELP_SCOUT_MAILBOX_APP_ID,
                    client_secret: config.HELP_SCOUT_MAILBOX_APP_SECRET,
                }).toString(),
            },
        );
        const text = await response.text();
        let data;

        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }

        if (!response.ok) {
            const message = `Help Scout OAuth failed (${response.status}): ${
                data?.error_description || data?.error || text || "unknown"
            }`;

            this.logger.error("Help Scout OAuth failed", {
                status: response.status,
            });
            throw new Error(message);
        }

        this.tokenCache = {
            accessToken: data.access_token,
            expiresAt:
                now +
                (data.expires_in ||
                    HELPSCOUT_DEFAULTS.TOKEN_EXPIRES_IN_SECONDS) *
                    1000,
        };

        this.logger.info("Received a Help Scout access token");

        return this.tokenCache.accessToken;
    }

    async mailboxRequest(path, options = {}) {
        const token = await this.getAccessToken();
        const send = (accessToken) =>
            this.httpClient(`${HELPSCOUT_API.BASE_URL}${path}`, {
                ...options,
                headers: {
                    Authorization: `${HELPSCOUT_API.BEARER_PREFIX}${accessToken}`,
                    "Content-Type": "application/json",
                    ...(options.headers || {}),
                },
            });
        const response = await send(token);

        if (response.status === 401 && this.tokenCache.accessToken) {
            this.logger.warn("Help Scout rejected the cached token, retrying", {
                path,
            });
            this.tokenCache = { accessToken: null, expiresAt: 0 };

            return await send(await this.getAccessToken());
        }

        return response;
    }

    async findCustomerIdByEmail(email) {
        const normalized = email.trim().toLowerCase();
        const query = encodeURIComponent(
            `(email:"${escapeQuery(normalized)}")`,
        );

        this.logger.info("Searching a Help Scout customer by email");

        const response = await this.mailboxRequest(
            `${HELPSCOUT_API.CUSTOMERS_PATH}?query=${query}`,
        );

        if (!response.ok) {
            const text = await response.text();

            throw new Error(
                `Help Scout customer search failed (${response.status}): ${text}`,
            );
        }

        const data = await response.json();
        const customers = data?._embedded?.customers;

        this.logger.info("Searched a Help Scout customer by email", {
            found: Boolean(customers?.length),
        });

        return customers?.length ? customers[0].id : null;
    }

    async createCustomerWithProperties(user, propertyEntries) {
        const { firstName, lastName } = splitName(user.name);

        this.logger.info("Creating a Help Scout customer");

        const response = await this.mailboxRequest(
            HELPSCOUT_API.CUSTOMERS_PATH,
            {
                method: "POST",
                body: JSON.stringify({
                    firstName,
                    lastName: lastName || undefined,
                    emails: [
                        {
                            type: "work",
                            value: user.email.trim().toLowerCase(),
                        },
                    ],
                    properties: propertyEntries.map(({ slug, value }) => ({
                        slug,
                        value: String(value),
                    })),
                }),
            },
        );

        if (response.status === 201) {
            const resourceId = response.headers.get("resource-id");

            this.logger.info("Created a Help Scout customer", { resourceId });

            return resourceId ? Number(resourceId) : null;
        }

        const text = await response.text();

        throw new Error(
            `Help Scout create customer failed (${response.status}): ${text}`,
        );
    }

    async updateCustomerProperties(customerId, propertyEntries) {
        this.logger.info("Updating Help Scout customer properties", {
            customerId,
        });

        const response = await this.mailboxRequest(
            `${HELPSCOUT_API.CUSTOMERS_PATH}/${customerId}/properties`,
            {
                method: "PATCH",
                body: JSON.stringify(
                    propertyEntries.map(({ slug, value }) => ({
                        op: "replace",
                        path: `/${slug}`,
                        value: String(value),
                    })),
                ),
            },
        );

        if (response.status === 204 || response.status === 200) {
            this.logger.info("Updated Help Scout customer properties", {
                customerId,
            });

            return;
        }

        const text = await response.text();

        throw new Error(
            `Help Scout update properties failed (${response.status}): ${text}`,
        );
    }

    async syncUserUtmToHelpScout(user) {
        this.logger.info("Syncing UTM attribution to Help Scout");

        if (!this.isMailboxApiConfigured()) {
            this.logger.warn("Help Scout mailbox credentials are missing");

            return {
                skipped: true,
                reason: HELPSCOUT_SKIP_REASONS.MAILBOX_API_NOT_CONFIGURED,
            };
        }

        if (!user?.email) {
            this.logger.warn("Help Scout UTM sync skipped, email missing");

            return {
                skipped: true,
                reason: HELPSCOUT_SKIP_REASONS.MISSING_EMAIL,
            };
        }

        const propertyEntries = this.buildUtmPropertyEntries(user);

        if (!propertyEntries.length) {
            this.logger.warn("Help Scout UTM sync skipped, no properties");

            return {
                skipped: true,
                reason: HELPSCOUT_SKIP_REASONS.NO_PROPERTIES,
            };
        }

        try {
            let customerId = await this.findCustomerIdByEmail(user.email);

            if (customerId) {
                await this.updateCustomerProperties(
                    customerId,
                    propertyEntries,
                );
            } else {
                customerId = await this.createCustomerWithProperties(
                    user,
                    propertyEntries,
                );
            }

            this.logger.info("Synced UTM attribution to Help Scout", {
                customerId,
            });

            return { ok: true, customerId };
        } catch (error) {
            this.logger.error("Help Scout UTM sync failed", {
                error: error.message,
            });

            return { ok: false, error: error.message };
        }
    }

    scheduleSyncUserUtmToHelpScout(user) {
        this.syncUserUtmToHelpScout(user).catch((error) => {
            this.logger.error("Unhandled Help Scout UTM sync error", {
                error: error.message,
            });
        });
    }

    scheduleSyncContactUtmToHelpScout({
        email,
        name,
        utmSource,
        utmCampaign,
        utmMedium,
        utmEmail,
    }) {
        if (!email) {
            this.logger.warn("Help Scout contact sync skipped, email missing");

            return;
        }

        this.scheduleSyncUserUtmToHelpScout({
            email,
            name: name || email,
            utmSource: utmSource || HELPSCOUT_DEFAULTS.UTM_VALUE,
            utmCampaign: utmCampaign || HELPSCOUT_DEFAULTS.UTM_VALUE,
            // utmEmail (email-flow attribution) overrides utmMedium — see
            // buildUtmPropertyEntries.
            utmMedium: utmMedium || HELPSCOUT_DEFAULTS.UTM_VALUE,
            utmEmail,
        });
    }
}

module.exports = { HelpscoutService };
