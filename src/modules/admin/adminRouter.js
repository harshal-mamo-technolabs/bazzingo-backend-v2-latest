const express = require("express");
const logger = require("../../config/logger");
const { asyncWrapper } = require("../../common/utils/wrapper");
const { AdminController } = require("./adminController");
const { AdminService } = require("./adminService");

const router = express.Router();

const adminService = new AdminService(logger);
const adminController = new AdminController(adminService, logger);

router
    .route("/signup")
    .post(asyncWrapper(adminController.signup.bind(adminController)));

router
    .route("/login")
    .post(asyncWrapper(adminController.login.bind(adminController)));

module.exports = router;
