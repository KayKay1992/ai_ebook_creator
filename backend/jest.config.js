module.exports = {
  testEnvironment: 'node',
  // mongodb-memory-server's first boot per file (downloading/spawning the
  // real mongod binary) is slower than a typical unit test — give it real
  // headroom rather than a flaky default 5s timeout.
  testTimeout: 30000,
  setupFiles: ['<rootDir>/tests/env.setup.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  // archiver's real package entry point is ESM-only and Jest's default CJS
  // transform can't parse it — see tests/__mocks__/archiver.js's comment
  // for why stubbing it out (rather than adding a Babel/ESM transform) is
  // the right call for a suite that never exercises EPUB export.
  moduleNameMapper: {
    '^archiver$': '<rootDir>/tests/__mocks__/archiver.js',
  },
};
