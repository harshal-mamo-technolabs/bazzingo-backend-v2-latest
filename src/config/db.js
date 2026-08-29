const mongoose = require("mongoose");
const { config } = require(".");
const logger = require("./logger");

const connectDb = async () => {
    logger.info("Connecting to the database");

    await mongoose.connect(config.MONGO_URI);

    logger.info("Database connected", { host: mongoose.connection.host });
};

const disconnectDb = async () => {
    await mongoose.disconnect();

    logger.info("Database disconnected");
};

module.exports = { connectDb, disconnectDb };
