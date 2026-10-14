const nodemailer = require('nodemailer');

// Two transports, picked at send time:
//
// 1. Brevo's HTTPS API (BREVO_API_KEY + EMAIL_FROM) — the production path.
//    Render's free tier blocks outbound SMTP (ports 25/465/587), so the old
//    Gmail SMTP transport could never connect there: the TCP connect was
//    silently dropped and, with nodemailer's default 2-minute connect / 10-
//    minute socket timeouts, every forgot-password request just hung. An
//    HTTPS API goes out over 443 like any other request. Brevo rather than
//    Resend because Brevo can send from a single verified sender address
//    (e.g. a Gmail address) without a verified custom domain, which this
//    app doesn't have yet.
// 2. Gmail SMTP (GMAIL_USER + GMAIL_APP_PASSWORD) — fallback for local dev
//    or any host that does allow outbound SMTP. Same deliverability caveats
//    as before (personal Gmail, no SPF/DKIM alignment for this app).
//
// Both transports have hard timeouts, so a send always settles (resolves or
// throws) within a bounded time instead of hanging the caller. Everything
// that calls sendEmail()/sendPasswordResetEmail() is decoupled from the
// transport, so swapping providers only ever touches this file.

const SEND_TIMEOUT_MS = 10000;
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

let smtpTransporter = null;
const getSmtpTransporter = () => {
    if (!smtpTransporter) {
        smtpTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD,
            },
            connectionTimeout: SEND_TIMEOUT_MS,
            greetingTimeout: SEND_TIMEOUT_MS,
            socketTimeout: SEND_TIMEOUT_MS,
        });
    }
    return smtpTransporter;
};

const getTransportName = () => {
    if (process.env.BREVO_API_KEY) return 'brevo';
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return 'smtp';
    return null;
};

const sendViaBrevo = async ({ to, subject, html, text }) => {
    const senderEmail = process.env.EMAIL_FROM || process.env.GMAIL_USER;
    if (!senderEmail) {
        throw new Error('[sendEmail] BREVO_API_KEY is set but EMAIL_FROM is missing — set it to a sender address verified in Brevo.');
    }

    let response;
    try {
        response = await fetch(BREVO_ENDPOINT, {
            method: 'POST',
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                sender: { name: 'Kenlibs', email: senderEmail },
                to: [{ email: to }],
                subject,
                htmlContent: html,
                textContent: text,
            }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            throw new Error(`[sendEmail] Brevo request timed out after ${SEND_TIMEOUT_MS}ms`);
        }
        throw new Error(`[sendEmail] Brevo request failed: ${error.message}`);
    }

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`[sendEmail] Brevo responded ${response.status}: ${body}`);
    }
};

const sendViaSmtp = async ({ to, subject, html, text }) => {
    await getSmtpTransporter().sendMail({
        from: `"Kenlibs" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html,
        text,
    });
};

// Fail loudly at startup (outside tests) rather than only discovering a
// missing config when a user tries to reset their password.
if (process.env.NODE_ENV !== 'test' && !getTransportName()) {
    console.error('[sendEmail] No email transport configured — set BREVO_API_KEY + EMAIL_FROM (or GMAIL_USER + GMAIL_APP_PASSWORD for local SMTP). Password reset emails will fail.');
}

//@desc  Low-level send — callers provide subject/html/text directly.
//       Throws on failure (including timeouts and missing config); callers
//       decide how to handle that (see authController.js/adminController.js's
//       password reset flows for two different, deliberate answers to "what
//       happens if this throws").
const sendEmail = async (message) => {
    const transport = getTransportName();
    if (transport === 'brevo') return sendViaBrevo(message);
    if (transport === 'smtp') return sendViaSmtp(message);
    throw new Error('[sendEmail] No email transport configured — set BREVO_API_KEY + EMAIL_FROM (or GMAIL_USER + GMAIL_APP_PASSWORD).');
};

// Shared HTML wrapper — terracotta/navy branding (Step 47's palette), a
// plain web-safe font stack rather than Fraunces/Inter (custom webfonts
// aren't reliably loaded by email clients, many of which strip <link>/
// @import entirely), and table-based layout for the same reason email HTML
// generally avoids relying on modern CSS (flexbox/grid support is
// inconsistent across clients like Outlook's Word-based renderer).
const emailShell = (bodyHtml) => `
<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#faf3e8;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf3e8; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius: 16px; overflow:hidden; max-width: 480px; width: 100%;">
            <tr>
              <td style="background-color:#1b2a4a; padding: 24px 32px;">
                <span style="color:#ffffff; font-size: 20px; font-weight: bold; font-family: Georgia, 'Times New Roman', serif;">Kenlibs</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px; font-family: Arial, Helvetica, sans-serif;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 32px; border-top: 1px solid #f0ebe3;">
                <p style="margin:0; color:#9a9488; font-size:12px; font-family: Arial, Helvetica, sans-serif;">
                  Kenlibs &middot; if you didn't request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

//@desc  The password reset email — used by both the self-service
//       (authController.js's forgotPassword) and admin-initiated
//       (adminController.js's resetUserPassword) flows, so both always
//       send the exact same thing to the account owner regardless of who
//       triggered it.
const sendPasswordResetEmail = async ({ to, resetLink, isAdminInitiated = false }) => {
    const intro = isAdminInitiated
        ? 'An admin initiated a password reset for your Kenlibs account.'
        : 'We received a request to reset your Kenlibs password.';

    const html = emailShell(`
      <h1 style="margin:0 0 16px; color:#111827; font-size:22px; font-family: Georgia, 'Times New Roman', serif;">Reset your password</h1>
      <p style="margin:0 0 24px; color:#4b5563; font-size:15px; line-height:1.6;">
        ${intro} Click the button below to choose a new one. This link expires in 1 hour.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td style="border-radius: 12px; background-color:#c4592f;">
            <a href="${resetLink}" style="display:inline-block; padding: 12px 28px; color:#ffffff; font-weight:bold; text-decoration:none; font-size:15px;">
              Reset Password
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:24px 0 0; color:#9ca3af; font-size:13px; line-height:1.5;">
        If the button doesn't work, copy and paste this link into your browser:<br />
        <a href="${resetLink}" style="color:#c4592f; word-break: break-all;">${resetLink}</a>
      </p>
      <p style="margin:20px 0 0; color:#9ca3af; font-size:13px;">
        If you didn't request this, you can safely ignore this email — your password won't change.
      </p>
    `);

    const text = [
        'Reset your Kenlibs password',
        '',
        `${intro} Use the link below within 1 hour:`,
        '',
        resetLink,
        '',
        "If you didn't request this, you can safely ignore this email.",
    ].join('\n');

    await sendEmail({ to, subject: 'Reset your Kenlibs password', html, text });
};

module.exports = { sendEmail, sendPasswordResetEmail };
