const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const { config } = require("../../config");
const logger = require("../../config/logger");
const { ADMIN_MESSAGES } = require("../../constants");
const Admin = require("../../modules/admin/adminModel");

const requireAdmin =
    (allowedRoles = []) =>
    async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                logger.warn("Admin authentication header missing", {
                    requestId: req.requestId,
                    path: req.originalUrl,
                });
                throw createHttpError(401, ADMIN_MESSAGES.AUTH_REQUIRED);
            }

            const token = authHeader.split(" ")[1];
            const decoded = jwt.verify(token, config.JWT_SECRET);
            const admin = await Admin.findById(decoded.adminId);

            if (!admin || !admin.isActive) {
                logger.warn("Admin token rejected", {
                    requestId: req.requestId,
                    adminId: decoded.adminId,
                    found: Boolean(admin),
                });
                throw createHttpError(401, ADMIN_MESSAGES.INVALID_ADMIN);
            }

            if (allowedRoles.length > 0 && !allowedRoles.includes(admin.role)) {
                logger.warn("Admin lacks the required role", {
                    requestId: req.requestId,
                    adminId: String(admin._id),
                    role: admin.role,
                    allowedRoles,
                });
                throw createHttpError(403, ADMIN_MESSAGES.FORBIDDEN);
            }

            logger.info("Admin request authenticated", {
                requestId: req.requestId,
                adminId: String(admin._id),
                role: admin.role,
            });

            req.admin = admin;
            next();
        } catch (err) {
            if (createHttpError.isHttpError(err)) {
                return next(err);
            }

            logger.warn("Admin token could not be verified", {
                requestId: req.requestId,
                reason: err.message,
            });

            return next(createHttpError(401, ADMIN_MESSAGES.INVALID_ADMIN));
        }
    };

module.exports = requireAdmin;
