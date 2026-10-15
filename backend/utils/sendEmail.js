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
const DEFAULT_FOOTER = "Kenlibs &middot; if you didn't request this, you can safely ignore this email.";

const emailShell = (bodyHtml, { footer = DEFAULT_FOOTER } = {}) => `
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
                  ${footer}
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

// ---------------------------------------------------------------------------
// Purchase emails. Everything a reader or admin typed (reader name, item
// title, admin note) goes through escapeHtml before it touches the HTML
// body, so a name like `<a href=...>` renders as text instead of a link.
// The plain-text versions don't need escaping. Neither version ever includes
// the payment evidence image URL.
// ---------------------------------------------------------------------------

const escapeHtml = (value = '') =>
    String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// Escaped, with the admin's own line breaks kept.
const escapeMultiline = (value = '') => escapeHtml(value).replace(/\r?\n/g, '<br />');

// Read at send time (like authController.js's buildResetLink), not at
// require time, so tests and config changes see the current value.
const frontendUrl = (path) => `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')}${path}`;

// Same format as the storefront's formatNaira (frontend/src/utils/kenlibsPricing.js).
const formatNaira = (amount) =>
    `₦${Number(amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

const formatSubmittedAt = (date) =>
    `${new Date(date).toLocaleString('en-GB', {
        timeZone: 'Africa/Lagos',
        dateStyle: 'medium',
        timeStyle: 'short',
    })} (WAT)`;

const PURCHASE_FOOTER = 'Kenlibs &middot; you received this because of a purchase request on Kenlibs.';

const emailHeading = (text) =>
    `<h1 style="margin:0 0 16px; color:#111827; font-size:22px; font-family: Georgia, 'Times New Roman', serif;">${text}</h1>`;

const emailParagraph = (html) =>
    `<p style="margin:0 0 16px; color:#4b5563; font-size:15px; line-height:1.6;">${html}</p>`;

// `href` is built by this file from FRONTEND_URL and ObjectIds, never from
// user input, but it's escaped anyway since it lands in an attribute.
const emailButton = (href, label) => `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px 0 0;">
        <tr>
          <td style="border-radius: 12px; background-color:#c4592f;">
            <a href="${escapeHtml(href)}" style="display:inline-block; padding: 12px 28px; color:#ffffff; font-weight:bold; text-decoration:none; font-size:15px;">
              ${label}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0; color:#9ca3af; font-size:13px; line-height:1.5;">
        If the button doesn't work, open this link:<br />
        <a href="${escapeHtml(href)}" style="color:#c4592f; word-break: break-all;">${escapeHtml(href)}</a>
      </p>`;

// Label/value rows. Values must already be escaped by the caller.
const emailDetails = (rows) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; background-color:#faf3e8; border-radius: 12px;">
        ${rows
            .map(
                ([label, valueHtml]) => `
        <tr>
          <td style="padding: 8px 16px; color:#9a9488; font-size:13px; width: 40%; vertical-align: top;">${label}</td>
          <td style="padding: 8px 16px; color:#111827; font-size:14px; font-weight:bold; vertical-align: top;">${valueHtml}</td>
        </tr>`
            )
            .join('')}
      </table>`;

// The admin's note, set apart so a rejection reason can't be missed.
const emailNote = (label, note) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px;">
        <tr>
          <td style="padding: 16px; background-color:#fff7ed; border-left: 4px solid #c4592f; border-radius: 8px;">
            <p style="margin:0 0 6px; color:#9a3412; font-size:12px; font-weight:bold; text-transform: uppercase; letter-spacing: 0.04em;">${label}</p>
            <p style="margin:0; color:#111827; font-size:15px; line-height:1.6;">${escapeMultiline(note)}</p>
          </td>
        </tr>
      </table>`;

const itemTypeLabel = (itemType) => (itemType === 'bundle' ? 'Bundle' : 'Book');

//@desc  Tells the admin a reader has submitted (or resubmitted, after a
//       rejection) a purchase request that needs reviewing.
const sendPurchaseRequestAdminEmail = async ({
    to,
    readerName,
    readerEmail,
    itemType,
    itemTitle,
    amount,
    creditApplied = 0,
    submittedAt = new Date(),
    isResubmission = false,
}) => {
    const reviewLink = frontendUrl('/admin/purchases');
    const typeLabel = itemTypeLabel(itemType);
    const credit = Number(creditApplied) || 0;
    const amountDue = Math.max(0, (Number(amount) || 0) - credit);
    const heading = isResubmission ? 'Purchase request resubmitted' : 'New purchase request';
    const intro = isResubmission
        ? 'A reader has resubmitted a purchase request you previously rejected, with new payment evidence. It is waiting for your review.'
        : 'A reader has submitted a purchase request with payment evidence. It is waiting for your review.';

    const rows = [
        ['Reader', escapeHtml(readerName || 'Unknown reader')],
        ['Email', escapeHtml(readerEmail || '—')],
        [typeLabel, escapeHtml(itemTitle || 'Untitled')],
        ['Price', escapeHtml(formatNaira(amount))],
        ...(credit > 0
            ? [
                  ['Store credit applied', escapeHtml(formatNaira(credit))],
                  ['Amount to verify', escapeHtml(formatNaira(amountDue))],
              ]
            : []),
        ['Submitted', escapeHtml(formatSubmittedAt(submittedAt))],
    ];

    const html = emailShell(
        `
      ${emailHeading(heading)}
      ${emailParagraph(intro)}
      ${emailDetails(rows)}
      ${emailButton(reviewLink, 'Review purchase requests')}
    `,
        { footer: 'Kenlibs &middot; admin notification.' }
    );

    const text = [
        heading,
        '',
        intro,
        '',
        `Reader: ${readerName || 'Unknown reader'}`,
        `Email: ${readerEmail || '-'}`,
        `${typeLabel}: ${itemTitle || 'Untitled'}`,
        `Price: ${formatNaira(amount)}`,
        ...(credit > 0
            ? [`Store credit applied: ${formatNaira(credit)}`, `Amount to verify: ${formatNaira(amountDue)}`]
            : []),
        `Submitted: ${formatSubmittedAt(submittedAt)}`,
        '',
        `Review it here: ${reviewLink}`,
    ].join('\n');

    const subject = `${isResubmission ? 'Resubmitted' : 'New'} purchase request: ${itemTitle || typeLabel}`;
    await sendEmail({ to, subject, html, text });
};

//@desc  Tells the reader the admin approved, rejected, or revoked their
//       purchase request. `decision` is the new status.
const sendPurchaseDecisionEmail = async ({
    to,
    readerName,
    decision,
    itemType,
    itemId,
    itemTitle,
    adminNote = '',
}) => {
    const typeWord = itemType === 'bundle' ? 'bundle' : 'book';
    const title = itemTitle || `your ${typeWord}`;
    const note = String(adminNote || '').trim();
    const myBooksLink = frontendUrl('/kenlibs/my-books');
    const greeting = `Hi ${readerName || 'there'},`;

    let subject;
    let heading;
    let introText;
    let introHtml;
    let noteLabel;
    let link;
    let buttonLabel;

    if (decision === 'approved') {
        // A book opens straight in the reader. A bundle has no single
        // reading page, so it goes to My Books, which lists every book in it.
        link = itemType === 'book' && itemId ? frontendUrl(`/kenlibs/read/${itemId}`) : myBooksLink;
        buttonLabel = itemType === 'book' && itemId ? 'Start reading' : 'Go to My Books';
        subject = `Your purchase is approved: ${title}`;
        heading = 'Your purchase is approved';
        introText = `Good news! Your payment for "${title}" has been confirmed, and the ${typeWord} is now in your library.`;
        introHtml = `Good news! Your payment for <strong>${escapeHtml(title)}</strong> has been confirmed, and the ${typeWord} is now in your library.`;
        noteLabel = 'Note from Kenlibs';
    } else if (decision === 'rejected') {
        link = myBooksLink;
        buttonLabel = 'Fix and resubmit';
        subject = `Your purchase request was not approved: ${title}`;
        heading = 'Your purchase request was not approved';
        introText = `We couldn't approve your purchase request for "${title}". You can upload new payment evidence from My Books and resubmit it.`;
        introHtml = `We couldn't approve your purchase request for <strong>${escapeHtml(title)}</strong>. You can upload new payment evidence from My Books and resubmit it.`;
        noteLabel = 'Reason';
    } else if (decision === 'revoked') {
        link = myBooksLink;
        buttonLabel = 'Go to My Books';
        subject = `Your access has changed: ${title}`;
        heading = 'Your access has changed';
        introText = `Your access to "${title}" has been removed by the Kenlibs team. This can happen when a payment is reversed or needs another look. If you have questions, please contact Kenlibs support.`;
        introHtml = `Your access to <strong>${escapeHtml(title)}</strong> has been removed by the Kenlibs team. This can happen when a payment is reversed or needs another look. If you have questions, please contact Kenlibs support.`;
        noteLabel = 'Note from Kenlibs';
    } else {
        throw new Error(`[sendPurchaseDecisionEmail] Unknown decision '${decision}'`);
    }

    const html = emailShell(
        `
      ${emailHeading(heading)}
      ${emailParagraph(escapeHtml(greeting))}
      ${emailParagraph(introHtml)}
      ${note ? emailNote(noteLabel, note) : ''}
      ${emailButton(link, buttonLabel)}
    `,
        { footer: PURCHASE_FOOTER }
    );

    const text = [
        heading,
        '',
        greeting,
        '',
        introText,
        ...(note ? ['', `${noteLabel}:`, note] : []),
        '',
        `${buttonLabel}: ${link}`,
    ].join('\n');

    await sendEmail({ to, subject, html, text });
};

const ERROR_ALERT_HEADINGS = {
    new: 'New error on Kenlibs',
    reopened: 'A resolved error is back',
    spike: 'An error is happening a lot',
};

//@desc  Error monitoring alert for the admin (utils/errorAlerts.js): a new
//       kind of error, a resolved one coming back, or a spike. Everything
//       in it was already scrubbed by utils/errorScrubber.js, and it's
//       escaped here too. No stack trace: that's on the admin page.
const sendErrorAlertEmail = async ({ to, kind, source, message, where, count, lastHourCount, environment }) => {
    const heading = ERROR_ALERT_HEADINGS[kind] || ERROR_ALERT_HEADINGS.new;
    const link = frontendUrl('/admin/errors');
    const rows = [
        ['Error', escapeHtml(message || '(no message)')],
        ['Source', escapeHtml(source)],
        ...(where ? [['Where', escapeHtml(where)]] : []),
        ['Times seen', escapeHtml(String(count))],
        ...(kind === 'spike' ? [['In the last hour', escapeHtml(String(lastHourCount))]] : []),
        ...(environment ? [['Environment', escapeHtml(environment)]] : []),
    ];
    const html = emailShell(
        `${emailHeading(heading)}
      ${emailParagraph('Kenlibs recorded this error. Details, including the stack trace, are on the Errors page.')}
      ${emailDetails(rows)}
      ${emailButton(link, 'Open the Errors page')}`,
        { footer: 'Kenlibs &middot; error monitoring. At most a few of these are sent per hour.' }
    );
    const text = [
        heading,
        '',
        `Error: ${message || '(no message)'}`,
        `Source: ${source}`,
        ...(where ? [`Where: ${where}`] : []),
        `Times seen: ${count}`,
        ...(kind === 'spike' ? [`In the last hour: ${lastHourCount}`] : []),
        ...(environment ? [`Environment: ${environment}`] : []),
        '',
        `Errors page: ${link}`,
    ].join('\n');
    return sendEmail({ to, subject: `[Kenlibs] ${heading}: ${String(message || '').slice(0, 80)}`, html, text });
};

module.exports = {
    sendEmail,
    sendErrorAlertEmail,
    sendPasswordResetEmail,
    sendPurchaseRequestAdminEmail,
    sendPurchaseDecisionEmail,
    escapeHtml,
};
