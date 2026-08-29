const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const useInMemoryDatabase = () => {
    let mongoServer;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
        await Promise.all(
            mongoose.modelNames().map((name) => mongoose.model(name).init()),
        );
    }, 120000);

    beforeEach(async () => {
        await Promise.all(
            Object.values(mongoose.connection.collections).map((collection) =>
                collection.deleteMany({}),
            ),
        );
    });

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });
};

module.exports = { useInMemoryDatabase };
