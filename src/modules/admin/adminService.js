const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { config } = require("../../config");
const { ADMIN_TOKEN_EXPIRY, BCRYPT_SALT_ROUNDS } = require("../../constants");
const Admin = require("./adminModel");

class AdminService {
    constructor(logger) {
        this.logger = logger;
    }

    async findByEmail(email) {
        return await Admin.findOne({ email: String(email).toLowerCase() });
    }

    async create({ name, email, password, role }) {
        this.logger.info("Persisting admin to the database", { email });

        const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

        const admin = await Admin.create({
            name,
            email,
            password: hashedPassword,
            role,
        });

        this.logger.info("Admin persisted to the database", {
            adminId: String(admin._id),
            role: admin.role,
        });

        return admin;
    }

    async verifyPassword(admin, password) {
        return await bcrypt.compare(password, admin.password);
    }

    issueToken(admin) {
        this.logger.info("Issuing admin access token", {
            adminId: String(admin._id),
            expiresIn: ADMIN_TOKEN_EXPIRY,
        });

        return jwt.sign({ adminId: admin._id }, config.JWT_SECRET, {
            expiresIn: ADMIN_TOKEN_EXPIRY,
        });
    }
}

module.exports = { AdminService };
