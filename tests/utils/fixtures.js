const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { config } = require("../../src/config");
const User = require("../../src/modules/user/userModel");
const Admin = require("../../src/modules/admin/adminModel");

const makeUserFields = (overrides = {}) => ({
    name: "Harshal",
    email: "harshal@bazzingo.com",
    password: "hashed-password",
    age: 27,
    country: "India",
    avatar: "avatar-1.png",
    ...overrides,
});

const createUser = async (overrides = {}) =>
    await User.create(makeUserFields(overrides));

const createAdmin = async (overrides = {}) =>
    await Admin.create({
        name: "Root",
        email: "root@bazzingo.com",
        password: await bcrypt.hash("super-secret", 10),
        role: "superadmin",
        ...overrides,
    });

const getAccessToken = (userId) =>
    jwt.sign({ userId: String(userId) }, config.JWT_SECRET, {
        expiresIn: "1h",
    });

const getAdminToken = (adminId) =>
    jwt.sign({ adminId: String(adminId) }, config.JWT_SECRET, {
        expiresIn: "1h",
    });

module.exports = {
    makeUserFields,
    createUser,
    createAdmin,
    getAccessToken,
    getAdminToken,
};
