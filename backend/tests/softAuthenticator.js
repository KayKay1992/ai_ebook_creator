// A software passkey authenticator for the tests: a real P-256 key pair,
// real CBOR attestation objects ("none" format) and real ES256 signatures,
// so @simplewebauthn/server's verification runs for real (nothing mocked).
// It produces exactly the JSON a browser's navigator.credentials sends
// (as @simplewebauthn/browser serialises it).
const crypto = require('crypto');
const { isoCBOR } = require('@simplewebauthn/server/helpers');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();
const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0);
    return b;
};

// Flags: UP 0x01, UV 0x04, BE 0x08, BS 0x10, AT 0x40.
const flagsByte = ({ up = true, uv = true, backedUp = false, attested = false }) =>
    (up ? 0x01 : 0) | (uv ? 0x04 : 0) | (backedUp ? 0x18 : 0) | (attested ? 0x40 : 0);

const createSoftAuthenticator = ({ rpID = 'localhost', origin = 'http://localhost:5173', counter = 0, backedUp = false } = {}) => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credentialId = crypto.randomBytes(32);
    const state = { counter, userHandle: null };

    const cosePublicKey = Buffer.from(
        isoCBOR.encode(
            new Map([
                [1, 2], // kty: EC2
                [3, -7], // alg: ES256
                [-1, 1], // crv: P-256
                [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
                [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
            ])
        )
    );

    const clientData = (type, challenge, overrides = {}) =>
        Buffer.from(JSON.stringify({ type, challenge, origin: overrides.origin || origin, crossOrigin: false }));

    // navigator.credentials.create() for these options.
    const register = (options, overrides = {}) => {
        state.userHandle = options.user?.id || null;
        const authData = Buffer.concat([
            sha256(overrides.rpID || rpID),
            Buffer.from([flagsByte({ uv: overrides.uv ?? true, backedUp, attested: true })]),
            u32(state.counter),
            Buffer.alloc(16), // AAGUID
            Buffer.from([credentialId.length >> 8, credentialId.length & 0xff]),
            credentialId,
            cosePublicKey,
        ]);
        const attestationObject = isoCBOR.encode(
            new Map([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', new Uint8Array(authData)],
            ])
        );
        return {
            id: b64url(credentialId),
            rawId: b64url(credentialId),
            type: 'public-key',
            response: {
                clientDataJSON: b64url(clientData('webauthn.create', overrides.challenge || options.challenge, overrides)),
                attestationObject: b64url(attestationObject),
                transports: ['internal', 'hybrid'],
            },
            clientExtensionResults: {},
            authenticatorAttachment: 'platform',
        };
    };

    // navigator.credentials.get() for these options. Each call increases the
    // counter by `step` (0 = an authenticator that always reports 0, like
    // synced passkeys); `counterOverride` replays a chosen value.
    const authenticate = (options, overrides = {}) => {
        if (overrides.counterOverride === undefined) state.counter += overrides.step ?? 1;
        const signCount = overrides.counterOverride ?? state.counter;
        const authData = Buffer.concat([
            sha256(overrides.rpID || rpID),
            Buffer.from([flagsByte({ uv: overrides.uv ?? true, backedUp })]),
            u32(signCount),
        ]);
        const clientDataJSON = clientData('webauthn.get', overrides.challenge || options.challenge, overrides);
        const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
        return {
            id: b64url(credentialId),
            rawId: b64url(credentialId),
            type: 'public-key',
            response: {
                clientDataJSON: b64url(clientDataJSON),
                authenticatorData: b64url(authData),
                signature: b64url(signature),
                ...(state.userHandle && overrides.userHandle !== null ? { userHandle: overrides.userHandle || state.userHandle } : {}),
            },
            clientExtensionResults: {},
            authenticatorAttachment: 'platform',
        };
    };

    return { credentialId: b64url(credentialId), register, authenticate, state };
};

module.exports = { createSoftAuthenticator };
