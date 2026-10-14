// Unit tests for utils/sendEmail.js's transport selection and failure modes.
// fetch is stubbed — nothing here ever reaches Brevo or Gmail.
const ENV_KEYS = ['BREVO_API_KEY', 'EMAIL_FROM', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'];
const originalEnv = {};
const originalFetch = global.fetch;

const loadSendEmail = () => {
    let mod;
    jest.isolateModules(() => {
        mod = require('../utils/sendEmail');
    });
    return mod;
};

const message = { to: 'reader@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

beforeEach(() => {
    ENV_KEYS.forEach((key) => {
        originalEnv[key] = process.env[key];
        delete process.env[key];
    });
});

afterEach(() => {
    ENV_KEYS.forEach((key) => {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
    });
    global.fetch = originalFetch;
});

describe('sendEmail', () => {
    it('throws a clear error when no transport is configured', async () => {
        const { sendEmail } = loadSendEmail();
        await expect(sendEmail(message)).rejects.toThrow(/no email transport configured/i);
    });

    it('sends through the Brevo HTTPS API when BREVO_API_KEY is set', async () => {
        process.env.BREVO_API_KEY = 'test-key';
        process.env.EMAIL_FROM = 'sender@example.com';
        global.fetch = jest.fn().mockResolvedValue({ ok: true });
        const { sendEmail } = loadSendEmail();

        await sendEmail(message);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.brevo.com/v3/smtp/email');
        expect(options.headers['api-key']).toBe('test-key');
        expect(options.signal).toBeDefined();
        const body = JSON.parse(options.body);
        expect(body.sender.email).toBe('sender@example.com');
        expect(body.to).toEqual([{ email: 'reader@example.com' }]);
    });

    it('throws when Brevo returns a non-2xx response', async () => {
        process.env.BREVO_API_KEY = 'test-key';
        process.env.EMAIL_FROM = 'sender@example.com';
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
        const { sendEmail } = loadSendEmail();

        await expect(sendEmail(message)).rejects.toThrow(/Brevo responded 401/);
    });

    it('turns a request timeout into a clear error instead of hanging', async () => {
        process.env.BREVO_API_KEY = 'test-key';
        process.env.EMAIL_FROM = 'sender@example.com';
        const timeoutError = new Error('The operation was aborted due to timeout');
        timeoutError.name = 'TimeoutError';
        global.fetch = jest.fn().mockRejectedValue(timeoutError);
        const { sendEmail } = loadSendEmail();

        await expect(sendEmail(message)).rejects.toThrow(/timed out/i);
    });

    it('fails loudly when BREVO_API_KEY is set without a sender address', async () => {
        process.env.BREVO_API_KEY = 'test-key';
        global.fetch = jest.fn();
        const { sendEmail } = loadSendEmail();

        await expect(sendEmail(message)).rejects.toThrow(/EMAIL_FROM is missing/);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
