const express = require("express");
const logger = require("../../config/logger");
const requireAdmin = require("../../common/middlewares/requireAdmin");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { PriceCatalogController } = require("./priceCatalogController");
const { PriceCatalogService } = require("./priceCatalogService");

const router = express.Router();

const priceCatalogController = new PriceCatalogController(
    new PriceCatalogService(logger),
    logger,
);

const handler = (method) =>
    asyncWrapper(priceCatalogController[method].bind(priceCatalogController));

router.route("/").post(requireAdmin(), handler("createPriceCatalog"));

module.exports = router;
