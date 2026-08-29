describe("stripe config", () => {
    it("should not throw when the secret key is missing", () => {
        const { config } = require("../../src/config");

        expect(config.STRIPE_SECRET_KEY).toBe("");
        expect(() => require("../../src/config/stripe")).not.toThrow();
    });

    it("should return no client when the secret key is missing", () => {
        const { getStripe } = require("../../src/config/stripe");

        expect(getStripe()).toBeNull();
    });
});
