const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

const connect = async () => {
  process.env.JWT_SECRET = 'skims-test-secret-key-for-testing-only';
  process.env.NODE_ENV = 'test';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
};

const disconnect = async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
};

const clearDB = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

module.exports = { connect, disconnect, clearDB };
