const User = require('../models/User');

// Who receives admin notification emails (purchase requests, error alerts):
// ADMIN_NOTIFY_EMAIL (comma-separated) wins; otherwise every admin account.
const getAdminNotifyEmails = async () => {
    const configured = (process.env.ADMIN_NOTIFY_EMAIL || '')
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean);
    if (configured.length) return configured;

    const admins = await User.find({ role: 'admin' }).select('email').lean();
    return [...new Set(admins.map((admin) => admin.email).filter(Boolean))];
};

module.exports = { getAdminNotifyEmails };
