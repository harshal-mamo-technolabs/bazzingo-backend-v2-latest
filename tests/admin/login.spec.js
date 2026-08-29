const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const Admin = require("../../src/modules/admin/adminModel");
const { config } = require("../../src/config");
const { useInMemoryDatabase } = require("../utils/db");

describe("POST /admin/login", () => {
    useInMemoryDatabase();

    const credentials = {
        email: "root@bazzingo.com",
        password: "super-secret",
    };

    const createAdmin = async (overrides = {}) =>
        await Admin.create({
            name: "Root",
            email: credentials.email,
            password: await bcrypt.hash(credentials.password, 10),
            role: "superadmin",
            ...overrides,
        });

    const login = (body = credentials) =>
        request(app).post("/admin/login").send(body);

    describe("given valid credentials", () => {
        it("should return a 200 status code", async () => {
            await createAdmin();

            const response = await login();

            expect(response.statusCode).toBe(200);
        });

        it("should return the success envelope", async () => {
            await createAdmin();

            const response = await login();

            expect(response.body.status).toBe("success");
            expect(response.body.message).toBe("Login successful");
        });

        it("should return a token signed for the admin", async () => {
            const admin = await createAdmin();

            const response = await login();

            const decoded = jwt.verify(
                response.body.data.token,
                config.JWT_SECRET,
            );
            expect(decoded.adminId).toBe(String(admin._id));
        });

        it("should accept the email in any case", async () => {
            await createAdmin();

            const response = await login({
                ...credentials,
                email: "ROOT@BAZZINGO.COM",
            });

            expect(response.statusCode).toBe(200);
        });

        it("should still log in an inactive admin", async () => {
            await createAdmin({ isActive: false });

            const response = await login();

            expect(response.statusCode).toBe(200);
        });
    });

    describe("given invalid credentials", () => {
        it("should return a 400 when the email is missing", async () => {
            const response = await login({ password: credentials.password });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Email and password are required",
            );
        });

        it("should return a 400 when the password is missing", async () => {
            const response = await login({ email: credentials.email });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe(
                "Email and password are required",
            );
        });

        it("should return a 400 when no admin has that email", async () => {
            const response = await login();

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Incorrect email or password");
        });

        it("should return a 400 when the password is wrong", async () => {
            await createAdmin();

            const response = await login({
                ...credentials,
                password: "wrong-password",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body.message).toBe("Incorrect email or password");
        });

        it("should not reveal whether the email exists", async () => {
            await createAdmin();

            const unknownEmail = await login({
                email: "nobody@bazzingo.com",
                password: credentials.password,
            });
            const wrongPassword = await login({
                ...credentials,
                password: "wrong-password",
            });

            expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
        });

        it("should never return a token when the login fails", async () => {
            await createAdmin();

            const response = await login({
                ...credentials,
                password: "wrong-password",
            });

            expect(response.body.data).toBeUndefined();
        });
    });
});
