const crypto = require("crypto");

// Short, URL-safe, unguessable id for public share links — 9 random bytes
// base64url-encodes to exactly 12 characters, no padding.
const generateShareId = () => crypto.randomBytes(9).toString("base64url");

module.exports = generateShareId;
