const nodemailer = require('nodemailer');

jest.mock('nodemailer');

const ORIGINAL_ENV = { ...process.env };

// emailService reads process.env at call time, so each test can flip transports by re-requiring.
const loadService = () => {
  let svc;
  jest.isolateModules(() => { svc = require('../services/emailService'); });
  return svc;
};

describe('emailService transport selection', () => {
  let sendMail;

  beforeEach(() => {
    jest.resetAllMocks();
    sendMail = jest.fn().mockResolvedValue({});
    nodemailer.createTransport.mockReturnValue({ sendMail });
    process.env.FROM_NAME = 'SKIMS';
    process.env.FROM_EMAIL = 'no-reply@skims.gov.ph';
    process.env.CLIENT_URL = 'https://skims-marinduque.netlify.app';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete global.fetch;
  });

  it('uses Resend when RESEND_API_KEY is set, and never touches SMTP', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'abc' }) });

    await loadService().sendEmailVerification({ email: 'a@example.com', firstName: 'Ana' }, 'tok123');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer re_test_key');

    const body = JSON.parse(opts.body);
    expect(body.to).toEqual(['a@example.com']);
    expect(body.from).toBe('SKIMS <no-reply@skims.gov.ph>');
    expect(body.subject).toMatch(/verify/i);
    expect(body.html).toContain('tok123');

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('falls back to SMTP when RESEND_API_KEY is absent', async () => {
    delete process.env.RESEND_API_KEY;

    await loadService().sendEmailVerification({ email: 'b@example.com', firstName: 'Ben' }, 'tok456');

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('b@example.com');
    expect(sendMail.mock.calls[0][0].from).toBe('"SKIMS" <no-reply@skims.gov.ph>');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws with the Resend error message when the API rejects the send', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ name: 'validation_error', message: 'The skims.gov.ph domain is not verified' }),
    });

    await expect(
      loadService().sendEmailVerification({ email: 'c@example.com', firstName: 'Cy' }, 'tok789')
    ).rejects.toThrow(/domain is not verified/);
  });

  it('still throws (so callers can log) when Resend returns a non-JSON error', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    global.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not json'); },
    });

    await expect(
      loadService().sendEmailVerification({ email: 'd@example.com', firstName: 'Dee' }, 'tok000')
    ).rejects.toThrow(/HTTP 502/);
  });

  it('redirects the recipient when RESEND_TO is set (unverified-domain demo mode)', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_TO = 'owner@example.com';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'abc' }) });

    await loadService().sendEmailVerification({ email: 'someone-else@example.com', firstName: 'Zed' }, 'tok');

    expect(JSON.parse(global.fetch.mock.calls[0][1].body).to).toEqual(['owner@example.com']);
  });

  it('does not redirect when RESEND_TO is unset', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.RESEND_TO;
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'abc' }) });

    await loadService().sendEmailVerification({ email: 'real-user@example.com', firstName: 'Rey' }, 'tok');

    expect(JSON.parse(global.fetch.mock.calls[0][1].body).to).toEqual(['real-user@example.com']);
  });

  it('formats peso amounts to exactly two decimals', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'abc' }) });

    await loadService().sendBudgetApproved(
      { email: 'f@example.com', firstName: 'Fe' },
      { title: 'FY2026', fiscalYear: 2026, totalBudget: 1234.567 }
    );

    const html = JSON.parse(global.fetch.mock.calls[0][1].body).html;
    expect(html).toContain('₱1,234.57');
    expect(html).not.toContain('1,234.567');
  });

  it('renders a zero amount rather than NaN when the amount is missing', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'abc' }) });

    await loadService().sendExpenseApproved(
      { email: 'g@example.com', firstName: 'Gab' },
      { title: 'Supplies', referenceNumber: 'EXP-1' }
    );

    const html = JSON.parse(global.fetch.mock.calls[0][1].body).html;
    expect(html).toContain('₱0.00');
    expect(html).not.toMatch(/NaN/);
  });

  it('logConfig warns when FROM_EMAIL is on a domain Resend must verify', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.FROM_EMAIL = 'noreply@skims.gov.ph';
    delete process.env.RESEND_TO;
    const logger = require('../utils/logger');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    // Plain require, NOT loadService(): isolateModules would give emailService its own logger
    // instance, and the spy below would never see the calls. logConfig reads env at call time.
    require('../services/emailService').logConfig();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skims.gov.ph'));
    warn.mockRestore();
  });

  it('logConfig does not warn about the domain for onboarding@resend.dev', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.FROM_EMAIL = 'onboarding@resend.dev';
    delete process.env.RESEND_TO;
    const logger = require('../utils/logger');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    // Plain require, NOT loadService(): isolateModules would give emailService its own logger
    // instance, and the spy below would never see the calls. logConfig reads env at call time.
    require('../services/emailService').logConfig();

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('verified at resend.com'));
    warn.mockRestore();
  });

  it('logConfig warns loudly while RESEND_TO is redirecting all mail', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.FROM_EMAIL = 'onboarding@resend.dev';
    process.env.RESEND_TO = 'devteam@example.com';
    const logger = require('../utils/logger');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    // Plain require, NOT loadService(): isolateModules would give emailService its own logger
    // instance, and the spy below would never see the calls. logConfig reads env at call time.
    require('../services/emailService').logConfig();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('devteam@example.com'));
    warn.mockRestore();
  });

  it('routes password reset through Resend too', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'abc' }) });

    await loadService().sendPasswordReset({ email: 'e@example.com', firstName: 'Eve' }, 'reset-tok');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).html).toContain('reset-tok');
  });
});
