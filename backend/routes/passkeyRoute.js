const express = require('express');
const {
    registerOptions,
    registerVerify,
    loginOptions,
    loginVerify,
    listPasskeys,
    renamePasskey,
    deletePasskey,
} = require('../controller/passkeyController');
const { protect } = require('../middleware/authMiddleware');
const {
    passkeyLoginOptionsLimiter,
    passkeyLoginVerifyIpLimiter,
    passkeyLoginVerifyCredentialLimiter,
    passkeyManageUserLimiter,
    passkeyManageIpLimiter,
} = require('../middleware/passkeyRateLimits');

// Passkeys, mounted at /api/auth/passkeys (app.js). See passkeyController.js.
const router = express.Router();

// Public: sign in with a passkey.
router.post('/login/options', passkeyLoginOptionsLimiter, loginOptions);
router.post('/login/verify', passkeyLoginVerifyIpLimiter, passkeyLoginVerifyCredentialLimiter, loginVerify);

// Signed in: manage your own passkeys.
const manage = [protect, passkeyManageIpLimiter, passkeyManageUserLimiter];
router.get('/', protect, listPasskeys);
router.post('/register/options', ...manage, registerOptions);
router.post('/register/verify', ...manage, registerVerify);
router.put('/:passkeyId', ...manage, renamePasskey);
router.delete('/:passkeyId', ...manage, deletePasskey);

module.exports = router;
