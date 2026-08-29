module.exports = {
    testEnvironment: "node",
    verbose: true,
    testMatch: ["**/tests/**/*.spec.js"],
    collectCoverageFrom: ["src/**/*.js", "!**/node_modules/**"],
};
