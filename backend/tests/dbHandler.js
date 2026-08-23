const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Each test file gets its own in-memory mongod (started in that file's
// beforeAll, stopped in its afterAll) rather than one instance shared across
// the whole run — slightly slower to boot per file, but keeps every test
// file's data completely isolated with no shared-state/ordering risk
// between files, which matters more than shaving a couple seconds off a
// suite this size.
let mongoServer;

const connect = async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
};

const closeDatabase = async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    if (mongoServer) {
        await mongoServer.stop();
    }
};

// Called between individual tests (not files) to reset state without paying
// the connect/disconnect cost every time.
const clearDatabase = async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({});
    }
};

module.exports = { connect, closeDatabase, clearDatabase };
