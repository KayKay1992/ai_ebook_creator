// Passkey (WebAuthn) relying-party settings (controller/passkeyController.js).
//
// The frontend (Vercel) and the API (Render) are on different domains. A
// passkey belongs to the domain of the PAGE that created it, so every
// verification uses the FRONTEND's origin and RP ID, never the API's:
//   WEBAUTHN_ORIGIN  the frontend origin(s) the browser reports, comma-
//                    separated if more than one; default FRONTEND_URL
//                    (default http://localhost:5173).
//   WEBAUTHN_RP_ID   the domain passkeys are bound to; default the host
//                    name of the first origin (e.g. kenlibs-sooty.vercel.app).
//                    Every origin must be that domain or a subdomain of it.
//   WEBAUTHN_RP_NAME shown by the browser/phone; default "Kenlibs".
// CHANGING THE RP ID (e.g. moving to a custom domain) MAKES EVERY EXISTING
// PASSKEY UNUSABLE: readers then sign in with their password and add a new
// passkey. Passwords are never affected.

const originOf = (value) => {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
};

const getWebAuthnConfig = (env = process.env) => {
    const origins = String(env.WEBAUTHN_ORIGIN || env.FRONTEND_URL || 'http://localhost:5173')
        .split(',')
        .map((o) => originOf(o.trim()))
        .filter(Boolean);
    if (!origins.length) origins.push('http://localhost:5173');
    const rpID = String(env.WEBAUTHN_RP_ID || new URL(origins[0]).hostname).trim().toLowerCase();
    const rpName = String(env.WEBAUTHN_RP_NAME || 'Kenlibs').trim() || 'Kenlibs';
    return { rpID, rpName, origins };
};

// True if every origin may use this RP ID (same host, or a subdomain of it).
const originsMatchRpId = ({ rpID, origins }) =>
    origins.every((origin) => {
        const host = new URL(origin).hostname;
        return host === rpID || host.endsWith(`.${rpID}`);
    });

module.exports = { getWebAuthnConfig, originsMatchRpId };
