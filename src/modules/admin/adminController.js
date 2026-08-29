const createHttpError = require("http-errors");
const { sendResponse } = require("../../common/utils/response");
const { RESPONSE_STATUS, ADMIN_MESSAGES } = require("../../constants");

class AdminController {
    constructor(adminService, logger) {
        this.adminService = adminService;
        this.logger = logger;
    }

    async signup(req, res, next) {
        const { name, email, password, role } = req.body;

        this.logger.info("Request to register an admin", {
            requestId: req.requestId,
            email,
            role,
        });

        if (!name || !email || !password) {
            this.logger.warn("Admin registration is missing required fields", {
                requestId: req.requestId,
                email,
            });
            return next(createHttpError(400, ADMIN_MESSAGES.SIGNUP_REQUIRED));
        }

        const existingAdmin = await this.adminService.findByEmail(email);

        if (existingAdmin) {
            this.logger.warn("Admin registration hit an existing email", {
                requestId: req.requestId,
                email,
            });
            return next(createHttpError(400, ADMIN_MESSAGES.ALREADY_EXISTS));
        }

        const admin = await this.adminService.create({
            name,
            email,
            password,
            role,
        });

        this.logger.info("Admin registered", {
            requestId: req.requestId,
            adminId: String(admin._id),
            role: admin.role,
        });

        return sendResponse(res, {
            statusCode: 201,
            status: RESPONSE_STATUS.SUCCESS,
            message: ADMIN_MESSAGES.REGISTERED,
            data: { token: this.adminService.issueToken(admin) },
        });
    }

    async login(req, res, next) {
        const { email, password } = req.body;

        this.logger.info("Request to log an admin in", {
            requestId: req.requestId,
            email,
        });

        if (!email || !password) {
            this.logger.warn("Admin login is missing credentials", {
                requestId: req.requestId,
            });
            return next(createHttpError(400, ADMIN_MESSAGES.LOGIN_REQUIRED));
        }

        const admin = await this.adminService.findByEmail(email);

        if (!admin) {
            this.logger.warn("Admin login hit an unknown email", {
                requestId: req.requestId,
                email,
            });
            return next(
                createHttpError(400, ADMIN_MESSAGES.INVALID_CREDENTIALS),
            );
        }

        const isMatch = await this.adminService.verifyPassword(admin, password);

        if (!isMatch) {
            this.logger.warn("Admin login hit a wrong password", {
                requestId: req.requestId,
                adminId: String(admin._id),
            });
            return next(
                createHttpError(400, ADMIN_MESSAGES.INVALID_CREDENTIALS),
            );
        }

        this.logger.info("Admin logged in", {
            requestId: req.requestId,
            adminId: String(admin._id),
            role: admin.role,
        });

        return sendResponse(res, {
            statusCode: 200,
            status: RESPONSE_STATUS.SUCCESS,
            message: ADMIN_MESSAGES.LOGIN_SUCCESS,
            data: { token: this.adminService.issueToken(admin) },
        });
    }
}

module.exports = { AdminController };
