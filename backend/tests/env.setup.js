// Runs before the test framework is installed (see jest.config.js's
// setupFiles), so JWT_SECRET is guaranteed to be set before any test file
// or app code that reads it executes. Deliberately does NOT set MONGO_URI —
// no test in this suite ever connects to a real MongoDB instance; each test
// file starts its own mongodb-memory-server (see tests/dbHandler.js) and
// connects mongoose directly to that instead. Cloudinary env vars are
// likewise never set here: any code path that would actually call
// Cloudinary is mocked (see tests/purchases.test.js and
// purchaseLifecycle.test.js), so no real credentials are ever needed.
process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-production';
process.env.NODE_ENV = 'test';
