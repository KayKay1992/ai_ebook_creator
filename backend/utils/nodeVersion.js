// The backend needs Node 20 or newer (@simplewebauthn/server for passkeys,
// and package.json "engines"). server.js calls assertSupportedNode() first
// thing, so an old Node fails at startup with a clear message instead of an
// obscure error the first time someone uses a passkey. On Render, set the
// NODE_VERSION environment variable (e.g. 22) if the default is older.

const MIN_NODE_MAJOR = 20;

const nodeMajor = (version = process.versions.node) => Number(String(version).split('.')[0]) || 0;

const isSupportedNode = (version) => nodeMajor(version) >= MIN_NODE_MAJOR;

const unsupportedNodeMessage = (version = process.versions.node) =>
    `Kenlibs backend needs Node ${MIN_NODE_MAJOR} or newer, but this is Node ${version}. ` +
    `Install a newer Node locally, or on Render set NODE_VERSION (e.g. 22) and redeploy.`;

const assertSupportedNode = (version = process.versions.node) => {
    if (!isSupportedNode(version)) {
        console.error(unsupportedNodeMessage(version));
        process.exit(1);
    }
};

module.exports = { MIN_NODE_MAJOR, isSupportedNode, unsupportedNodeMessage, assertSupportedNode };
