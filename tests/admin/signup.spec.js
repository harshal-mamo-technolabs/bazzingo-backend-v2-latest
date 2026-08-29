const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const Admin = require("../../src/modules/admin/adminModel");
const { config } = require("../../src/config");
const { useInMemoryDatabase } = require("../utils/db");

describe("POST /admin/signup", () => {
    useInMemoryDatabase();

    const validBody = {
        name: "Root",
        email: "root@bazzingo.com",
        password: "super-secret",
        role: "superadmin",
    };

    const signup = (body = validBody) =>
        request(app).post("/admin/signup").send(body);

    describe("given a valid body", () => {
        it("should return a 201 status code", async () => {
            const response = await signup();

            expect(response.statusCode).toBe(201);
        });

        it("should return the success envelope", async () => {
            const response = await signup();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Admin registered successfully");
        });

        it("should return a token signed for the new admin", async () => {
            const response = await signup();

            const decoded = jwt.verify(
                response.body.data.token,
                config.JWT_SECRET,
            );
            const admin = await Admin.findOne({ email: validBody.email });

            expect(decoded.adminId).toBe(String(admin._id));
        });

        it("should persist the admin", async () => {
            await signup();

            const admins = await Admin.find();
            expect(admins).toHaveLength(1);
            expect(admins[0].name).toBe("Root");
            expect(admins[0].role).toBe("superadmin");
        });

        it("should never store the password in plain text", async () => {
            await signup();

            const admin = await Admin.findOne({ email: validBody.email });
            expect(admin.password).not.toBe(validBody.password);
            expect(
                await bcrypt.compare(validBody.password, admin.password),
            ).toBe(true);
        });

        it("should lowercase the email", async () => {
            await signup({ ...validBody, email: "ROOT@BAZZINGO.COM" });

            const admin = await Admin.findOne({ email: "root@bazzingo.com" });
            expect(admin).not.toBeNull();
        });

        it("should default the role to manager", async () => {
            const { role, ...withoutRole } = validBody;

            await signup(withoutRole);

            const admin = await Admin.findOne({ email: validBody.email });
            expect(admin.role).toBe("manager");
        });

        it("should default isActive to true", async () => {
            await signup();

            const admin = await Admin.findOne({ email: validBody.email });
            expect(admin.isActive).toBe(true);
        });
    });

    describe("given an invalid body", () => {
        it("should return a 400 when the email is already registered", async () => {
            await signup();

            const response = await signup();

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Admin already exists with this email",
            );
        });

        it("should match an existing email case insensitively", async () => {
            await signup();

            const response = await signup({
                ...validBody,
                email: "ROOT@BAZZINGO.COM",
            });

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 when the name is missing", async () => {
            const { name, ...withoutName } = validBody;

            const response = await signup(withoutName);

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 when the email is missing", async () => {
            const { email, ...withoutEmail } = validBody;

            const response = await signup(withoutEmail);

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 when the password is missing", async () => {
            const { password, ...withoutPassword } = validBody;

            const response = await signup(withoutPassword);

            expect(response.statusCode).toBe(400);
        });

        it("should return a 400 when the role is not in the enum", async () => {
            const response = await signup({ ...validBody, role: "root" });

            expect(response.statusCode).toBe(400);
        });

        it("should not persist anything when the body is rejected", async () => {
            await signup({ ...validBody, role: "root" });

            expect(await Admin.countDocuments()).toBe(0);
        });
    });
});
