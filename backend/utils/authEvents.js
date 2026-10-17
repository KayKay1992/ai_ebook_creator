const AuthEvent = require('../models/AuthEvent');

// Records a passkey event (models/AuthEvent.js). Fire-and-forget: never
// awaited by a request, never throws. Only the fields below are stored.
const recordAuthEvent = (userId, type, nickname = '') => {
    try {
        AuthEvent.create({ userId, type, nickname: String(nickname || '').slice(0, 60) }).catch((error) =>
            console.error(`[authEvents] Couldn't record ${type}:`, error.message)
        );
    } catch (error) {
        console.error(`[authEvents] Couldn't record ${type}:`, error.message);
    }
};

module.exports = { recordAuthEvent };
