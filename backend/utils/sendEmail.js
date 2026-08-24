const nodemailer = require('nodemailer');

// INTERIM SOLUTION, NOT THE FINAL ONE — sends through a personal Gmail
// account (an app password, not OAuth) rather than a dedicated
// transactional email provider, because a verifiable custom domain isn't
// available yet. This genuinely delivers mail, but has real limits worth
// knowing about: Gmail's SMTP relay isn't meant for application traffic
// and rate-limits accordingly, and mail from a personal @gmail.com address
// can't carry this app's own SPF/DKIM/DMARC alignment, so it's more likely
// to be flagged as spam than mail from a verified sending domain. Swap
// this transport for a real provider (Resend, Postmark, SendGrid, etc.)
// once a custom domain exists — everything that calls sendEmail()/
// sendPasswordResetEmail() below is already decoupled from the transport
// itself, so that swap should only ever touch this one file.
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

//@desc  Low-level send — callers provide subject/html/text directly.
//       Throws on failure; callers decide how to handle that (see
//       authController.js/adminController.js's password reset flows for
//       two different, deliberate answers to "what happens if this
//       throws").
const sendEmail = async ({ to, subject, html, text }) => {
    await transporter.sendMail({
        from: `"Kenlibs" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html,
        text,
    });
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
