const path = require("path");
const winston = require("winston");
const { config } = require(".");

const LOGS_DIRECTORY = path.join(__dirname, "../../logs");
const IS_TEST = config.NODE_ENV === "test";

const logger = winston.createLogger({
    level: config.LOG_LEVEL,
    defaultMeta: {
        serviceName: "bazzingo-backend",
        environment: config.NODE_ENV,
    },
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
    ),
    transports: [
        new winston.transports.File({
            dirname: LOGS_DIRECTORY,
            filename: "combined.log",
            level: config.LOG_LEVEL,
            silent: IS_TEST,
        }),
        new winston.transports.File({
            dirname: LOGS_DIRECTORY,
            filename: "error.log",
            level: "error",
            silent: IS_TEST,
        }),
        new winston.transports.Console({
            level: config.LOG_LEVEL,
            silent: IS_TEST,
        }),
    ],
    exceptionHandlers: [
        new winston.transports.File({
            dirname: LOGS_DIRECTORY,
            filename: "exceptions.log",
            silent: IS_TEST,
        }),
        new winston.transports.Console({ silent: IS_TEST }),
    ],
    rejectionHandlers: [
        new winston.transports.File({
            dirname: LOGS_DIRECTORY,
            filename: "rejections.log",
            silent: IS_TEST,
        }),
        new winston.transports.Console({ silent: IS_TEST }),
    ],
    exitOnError: false,
});

module.exports = logger;
