const app = require("./app");
const { config } = require("./config");
const logger = require("./config/logger");
const cron = require("node-cron");
const { connectDb, disconnectDb } = require("./config/db");
const { initJobs } = require("./jobs");
const {
    certificateService,
} = require("./modules/certificate/certificateRouter");

const startServer = async () => {
    try {
        await connectDb();

        initJobs({ scheduler: cron, logger });

        const server = app.listen(config.PORT, () =>
            logger.info("Server started", {
                port: config.PORT,
                environment: config.NODE_ENV,
            }),
        );

        const shutdown = async (signal) => {
            logger.info("Shutdown signal received", { signal });

            server.close(async () => {
                await certificateService.cleanup();
                await disconnectDb();
                logger.info("Server stopped", { signal });
                process.exit(0);
            });
        };

        process.on("SIGTERM", () => void shutdown("SIGTERM"));
        process.on("SIGINT", () => void shutdown("SIGINT"));
    } catch (err) {
        logger.error("Server failed to start", {
            message: err.message,
            stack: err.stack,
        });
        logger.on("finish", () => process.exit(1));
        logger.end();
    }
};

process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", {
        message: err.message,
        stack: err.stack,
    });
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
    });
    process.exit(1);
});

void startServer();
