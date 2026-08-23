// Manual mock for the `archiver` package (see jest.config.js's
// moduleNameMapper). archiver's real entry point is ESM-only, which Jest's
// default CJS transform can't parse — and this test suite never actually
// exercises EPUB export (controller/exportController.js's only use of
// archiver's ZipArchive), so there's nothing to genuinely mock beyond
// satisfying the `require("archiver")` at the top of that file so importing
// app.js doesn't blow up. If a future test suite actually covers export
// functionality, this needs to become a real mock (or the transform issue
// needs solving properly), not just this stub.
class ZipArchive {}

module.exports = { ZipArchive };
