const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');
const User = require('../models/User');
const Passkey = require('../models/Passkey');
const WebAuthnChallenge = require('../models/WebAuthnChallenge');
const { getWebAuthnConfig } = require('../config/webauthn');
const { generateToken } = require('./authController');
const { recordAuthEvent } = require('../utils/authEvents');

// Passkey ("fingerprint / Face ID / screen lock") sign-in, alongside the
// email+password login (KENLIBS-ARCHITECTURE.md, "Passkeys").
//  - Adding a passkey needs a signed-in user, and either a sign-in in the
//    last FRESH_LOGIN_MS or the account password.
//  - Every challenge is made here, stored in MongoDB (WebAuthnChallenge,
//    5 minutes) and deleted the moment verify reads it (single use).
//  - Sign-in works with or without an email typed in: the options never
//    depend on the email (always "discoverable" passkeys), so they say
//    nothing about whether an account exists. Every sign-in failure gets
//    the same message.
//  - A passkey sign-in returns exactly what POST /api/auth/login returns.
//  - User verification (fingerprint, face, PIN/screen lock) is required.

const MAX_PASSKEYS = Passkey.MAX_PASSKEYS_PER_USER;
const FRESH_LOGIN_MS = 10 * 60 * 1000;
const CEREMONY_TIMEOUT_MS = 2 * 60 * 1000;
const GENERIC_LOGIN_FAILURE = "Couldn't sign you in with that passkey. Try again, or use your email and password.";

const sendServerError = (res, error) => {
    res.locals.error = error;
    res.status(500).json({ message: 'Server Error' });
};

// Plain text, single line, at most 60 characters.
const cleanNickname = (value, fallback = 'Passkey') => {
    const text = String(value ?? '')
        .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
        .trim();
    return text || fallback;
};

const publicView = (p) => ({
    _id: p._id,
    nickname: p.nickname,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
    deviceType: p.deviceType,
    backedUp: p.backedUp,
});

// WebAuthn user handle: the account's ObjectId bytes (12), never the email.
const userHandleFor = (userId) => new Uint8Array(Buffer.from(String(userId), 'hex'));

// When the bearer token was issued (protect has already verified it).
const tokenIssuedAtMs = (req) => {
    try {
        const token = String(req.headers.authorization || '').split(' ')[1];
        const decoded = jwt.decode(token);
        return decoded?.iat ? decoded.iat * 1000 : 0;
    } catch {
        return 0;
    }
};

// Single use: the challenge is deleted as it's read, whatever happens next.
const takeChallenge = (flowId, filter) => {
    if (!mongoose.isValidObjectId(flowId)) return null;
    return WebAuthnChallenge.findOneAndDelete({ _id: flowId, ...filter, expiresAt: { $gt: new Date() } });
};

const createChallenge = async ({ purpose, challenge, userId = null, email = '' }) =>
    WebAuthnChallenge.create({
        purpose,
        challenge,
        userId,
        email,
        expiresAt: new Date(Date.now() + WebAuthnChallenge.CHALLENGE_TTL_MS),
    });

//@desc    Start adding a passkey to the signed-in account
//@route   POST /api/auth/passkeys/register/options   { password? }
//@access  Private
const registerOptions = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('+password');
        if (!user || user.isDeleted) return res.status(401).json({ message: 'Not authorized' });

        const fresh = Date.now() - tokenIssuedAtMs(req) <= FRESH_LOGIN_MS;
        if (!fresh) {
            const password = typeof req.body?.password === 'string' ? req.body.password : '';
            if (!password) {
                return res.status(403).json({ code: 'password_required', message: 'Enter your password to add a passkey.' });
            }
            if (!(await user.matchPassword(password))) {
                return res.status(403).json({ code: 'wrong_password', message: "That password isn't right." });
            }
        }

        const existing = await Passkey.find({ userId: user._id }).select('credentialID transports').lean();
        if (existing.length >= MAX_PASSKEYS) {
            return res.status(409).json({ code: 'limit', message: `You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.` });
        }

        const { rpID, rpName } = getWebAuthnConfig();
        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userName: user.email,
            userDisplayName: user.name || user.email,
            userID: userHandleFor(user._id),
            attestationType: 'none',
            timeout: CEREMONY_TIMEOUT_MS,
            excludeCredentials: existing.map((p) => ({ id: p.credentialID, transports: p.transports })),
            // Discoverable ("resident") credentials, so sign-in works with
            // one tap and no email; user verification always.
            authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        });
        const flow = await createChallenge({ purpose: 'register', challenge: options.challenge, userId: user._id });
        res.set('Cache-Control', 'no-store');
        res.status(200).json({ flowId: flow._id, options });
    } catch (error) {
        sendServerError(res, error);
    }
};

//@desc    Finish adding a passkey
//@route   POST /api/auth/passkeys/register/verify   { flowId, response, nickname }
//@access  Private
const registerVerify = async (req, res) => {
    try {
        const { flowId, response, nickname } = req.body || {};
        if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
            return res.status(400).json({ message: 'Missing passkey response.' });
        }
        const challenge = await takeChallenge(flowId, { purpose: 'register', userId: req.user._id });
        if (!challenge) {
            return res.status(400).json({ code: 'expired', message: 'That request expired. Please try again.' });
        }

        const { rpID, origins } = getWebAuthnConfig();
        let verification;
        try {
            verification = await verifyRegistrationResponse({
                response,
                expectedChallenge: challenge.challenge,
                expectedOrigin: origins,
                expectedRPID: rpID,
                requireUserVerification: true,
            });
        } catch {
            verification = { verified: false };
        }
        if (!verification.verified) {
            return res.status(400).json({ code: 'not_verified', message: "That passkey couldn't be verified. Please try again." });
        }

        if ((await Passkey.countDocuments({ userId: req.user._id })) >= MAX_PASSKEYS) {
            return res.status(409).json({ code: 'limit', message: `You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.` });
        }

        const info = verification.registrationInfo;
        const transports = Array.isArray(response.response?.transports)
            ? response.response.transports.filter((t) => typeof t === 'string').slice(0, 10)
            : info.credential.transports || [];
        let passkey;
        try {
            passkey = await Passkey.create({
                userId: req.user._id,
                credentialID: info.credential.id,
                publicKey: Buffer.from(info.credential.publicKey),
                counter: info.credential.counter || 0,
                transports,
                deviceType: info.credentialDeviceType,
                backedUp: info.credentialBackedUp,
                nickname: cleanNickname(nickname),
            });
        } catch (error) {
            if (error?.code === 11000) {
                return res.status(409).json({ code: 'duplicate', message: 'This passkey is already added.' });
            }
            throw error;
        }
        recordAuthEvent(req.user._id, 'passkey_added', passkey.nickname);
        res.status(201).json({ passkey: publicView(passkey) });
    } catch (error) {
        sendServerError(res, error);
    }
};

//@desc    Start a passkey sign-in (email optional)
//@route   POST /api/auth/passkeys/login/options   { email? }
//@access  Public
const loginOptions = async (req, res) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
        const { rpID } = getWebAuthnConfig();
        // Never depends on the email or any account: no allowCredentials,
        // so the response looks the same for everyone.
        const options = await generateAuthenticationOptions({
            rpID,
            timeout: CEREMONY_TIMEOUT_MS,
            userVerification: 'required',
        });
        const flow = await createChallenge({ purpose: 'login', challenge: options.challenge, email });
        res.set('Cache-Control', 'no-store');
        res.status(200).json({ flowId: flow._id, options });
    } catch (error) {
        sendServerError(res, error);
    }
};

//@desc    Finish a passkey sign-in; same response as POST /api/auth/login
//@route   POST /api/auth/passkeys/login/verify   { flowId, response }
//@access  Public
const loginVerify = async (req, res) => {
    try {
        const { flowId, response } = req.body || {};
        if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
            return res.status(400).json({ message: GENERIC_LOGIN_FAILURE });
        }
        const challenge = await takeChallenge(flowId, { purpose: 'login' });
        if (!challenge) {
            return res.status(400).json({ code: 'expired', message: 'That sign-in request expired. Please try again.' });
        }
        const fail = () => res.status(400).json({ code: 'failed', message: GENERIC_LOGIN_FAILURE });

        const passkey = await Passkey.findOne({ credentialID: response.id }).select('+publicKey');
        if (!passkey) return fail();
        const user = await User.findById(passkey.userId);
        if (!user || user.isDeleted) return fail();
        // An email was typed in: only that account's passkeys sign in.
        if (challenge.email && String(user.email).toLowerCase() !== challenge.email) return fail();
        const userHandle = response.response?.userHandle;
        if (userHandle && userHandle !== isoBase64URL.fromBuffer(userHandleFor(user._id))) return fail();

        const { rpID, origins } = getWebAuthnConfig();
        let verification;
        try {
            verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge: challenge.challenge,
                expectedOrigin: origins,
                expectedRPID: rpID,
                credential: {
                    id: passkey.credentialID,
                    publicKey: new Uint8Array(passkey.publicKey),
                    counter: passkey.counter,
                    transports: passkey.transports,
                },
                requireUserVerification: true,
            });
        } catch (error) {
            // The library throws when a non-zero signature counter didn't go
            // up: a sign of a cloned authenticator or a replayed response.
            if (/counter/i.test(error?.message || '')) {
                console.warn(`[passkeys] Rejected a passkey sign-in with a counter that didn't increase (passkey ${passkey._id}).`);
            }
            return fail();
        }
        if (!verification.verified) return fail();

        // Only if nobody updated the counter in the meantime (two sign-ins
        // racing with copies of the same authenticator).
        const { newCounter, credentialBackedUp, credentialDeviceType } = verification.authenticationInfo;
        const updated = await Passkey.findOneAndUpdate(
            { _id: passkey._id, counter: passkey.counter },
            { $set: { counter: newCounter, lastUsedAt: new Date(), backedUp: credentialBackedUp, deviceType: credentialDeviceType } },
            { returnDocument: 'after' }
        );
        if (!updated) return fail();

        recordAuthEvent(user._id, 'passkey_login', passkey.nickname);
        res.status(200).json({
            message: 'Login successful',
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            token: generateToken(user._id),
        });
    } catch (error) {
        sendServerError(res, error);
    }
};

//@desc    The signed-in user's passkeys
//@route   GET /api/auth/passkeys
//@access  Private
const listPasskeys = async (req, res) => {
    try {
        const passkeys = await Passkey.find({ userId: req.user._id }).sort({ createdAt: 1 }).lean();
        res.set('Cache-Control', 'no-store');
        res.status(200).json({ passkeys: passkeys.map(publicView), max: MAX_PASSKEYS });
    } catch (error) {
        sendServerError(res, error);
    }
};

//@desc    Rename one of your passkeys
//@route   PUT /api/auth/passkeys/:passkeyId   { nickname }
//@access  Private (own passkeys only)
const renamePasskey = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.passkeyId)) return res.status(404).json({ message: 'Passkey not found' });
        const nickname = cleanNickname(req.body?.nickname, '');
        if (!nickname) return res.status(400).json({ message: 'Give the passkey a name.' });
        const passkey = await Passkey.findOneAndUpdate(
            { _id: req.params.passkeyId, userId: req.user._id },
            { $set: { nickname } },
            { returnDocument: 'after' }
        );
        if (!passkey) return res.status(404).json({ message: 'Passkey not found' });
        recordAuthEvent(req.user._id, 'passkey_renamed', nickname);
        res.status(200).json({ passkey: publicView(passkey) });
    } catch (error) {
        sendServerError(res, error);
    }
};

//@desc    Remove one of your passkeys (your password keeps working)
//@route   DELETE /api/auth/passkeys/:passkeyId
//@access  Private (own passkeys only)
const deletePasskey = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.passkeyId)) return res.status(404).json({ message: 'Passkey not found' });
        const passkey = await Passkey.findOneAndDelete({ _id: req.params.passkeyId, userId: req.user._id });
        if (!passkey) return res.status(404).json({ message: 'Passkey not found' });
        recordAuthEvent(req.user._id, 'passkey_removed', passkey.nickname);
        res.status(200).json({ message: 'Passkey removed.' });
    } catch (error) {
        sendServerError(res, error);
    }
};

module.exports = {
    registerOptions,
    registerVerify,
    loginOptions,
    loginVerify,
    listPasskeys,
    renamePasskey,
    deletePasskey,
    FRESH_LOGIN_MS,
};
