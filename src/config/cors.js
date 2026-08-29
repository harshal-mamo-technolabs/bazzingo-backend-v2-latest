const { config } = require(".");
const logger = require("./logger");
const { DEFAULT_ALLOWED_ORIGINS, CORS_OPTIONS } = require("../constants");

const withWwwVariants = (origins) => {
    const expanded = new Set(origins);

    for (const origin of origins) {
        try {
            const url = new URL(origin);
            const port = url.port ? `:${url.port}` : "";

            expanded.add(
                url.hostname.startsWith("www.")
                    ? `${url.protocol}//${url.hostname.slice(4)}${port}`
                    : `${url.protocol}//www.${url.hostname}${port}`,
            );
        } catch {
            logger.warn("Ignoring an invalid allowed origin", { origin });
        }
    }

    return expanded;
};

const allowedOrigins = [
    ...new Set([...DEFAULT_ALLOWED_ORIGINS, ...config.ALLOWED_ORIGINS]),
];

const allowedOriginSet = withWwwVariants(allowedOrigins);

const isOriginAllowed = (origin) => !origin || allowedOriginSet.has(origin);

const corsOptions = {
    origin(origin, callback) {
        if (isOriginAllowed(origin)) {
            return callback(null, true);
        }

        logger.warn("CORS blocked an origin", { origin });

        return callback(null, false);
    },
    credentials: true,
    methods: CORS_OPTIONS.METHODS,
    exposedHeaders: CORS_OPTIONS.EXPOSED_HEADERS,
    optionsSuccessStatus: CORS_OPTIONS.OPTIONS_SUCCESS_STATUS,
};

module.exports = { corsOptions, allowedOrigins, isOriginAllowed };
