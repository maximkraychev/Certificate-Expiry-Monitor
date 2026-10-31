import nodemailer from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Digest } from '../../src/mail/digest';
import { createMailer } from '../../src/mail/transport';
import { testConfig } from '../helpers';

const transporter = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({ messageId: '<1@test>' })), close: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => transporter),
    createTestAccount: vi.fn(async () => ({
      user: 'ethereal-user',
      pass: 'ethereal-pass',
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
    })),
    getTestMessageUrl: vi.fn(() => 'https://ethereal.email/message/abc'),
  },
}));

const mocked = vi.mocked(nodemailer);
const digest: Digest = { subject: 'Certificate alert: 1 WARNING', text: 'text body', html: '<p>html body</p>' };
const smtpConfig = {
  ...testConfig,
  smtp: { host: 'smtp.example.com', port: 587, user: 'mailer', pass: 'secret' },
  mailFrom: 'Certs <certs@example.com>',
};

describe('createMailer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends through the configured SMTP server from MAIL_FROM', async () => {
    const mailer = createMailer(smtpConfig, { log: vi.fn() });

    await mailer.sendMail('ops@example.com', digest);

    expect(mocked.createTransport).toHaveBeenCalledExactlyOnceWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'mailer', pass: 'secret' },
    });
    expect(mocked.createTestAccount).not.toHaveBeenCalled();
    expect(transporter.sendMail).toHaveBeenCalledExactlyOnceWith({
      from: 'Certs <certs@example.com>',
      to: 'ops@example.com',
      subject: digest.subject,
      text: digest.text,
      html: digest.html,
    });
  });

  it('uses implicit TLS on port 465 and no auth without a user', async () => {
    const mailer = createMailer({ ...smtpConfig, smtp: { host: 'smtp.example.com', port: 465, user: '', pass: '' } });

    await mailer.sendMail('ops@example.com', digest);

    expect(mocked.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, auth: undefined }));
  });

  it('reuses one transport and closes it', async () => {
    const mailer = createMailer(smtpConfig);

    await mailer.sendMail('a@example.com', digest);
    await mailer.sendMail('b@example.com', digest);
    mailer.close();
    await Promise.resolve();

    expect(mocked.createTransport).toHaveBeenCalledOnce();
    expect(transporter.close).toHaveBeenCalledOnce();
  });

  it('rejects when the send fails', async () => {
    transporter.sendMail.mockRejectedValueOnce(new Error('550 mailbox unavailable'));
    const mailer = createMailer(smtpConfig);

    await expect(mailer.sendMail('bad@example.com', digest)).rejects.toThrow('550 mailbox unavailable');
  });

  describe('without SMTP_HOST', () => {
    it('creates an Ethereal account on the first send only, and logs the preview URL', async () => {
      const log = vi.fn();
      const mailer = createMailer(testConfig, { log });
      expect(mocked.createTestAccount).not.toHaveBeenCalled();

      await mailer.sendMail('ops@example.com', digest);
      await mailer.sendMail('dev@example.com', digest);

      expect(mocked.createTestAccount).toHaveBeenCalledOnce();
      expect(mocked.createTransport).toHaveBeenCalledExactlyOnceWith({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: 'ethereal-user', pass: 'ethereal-pass' },
      });
      expect(log).toHaveBeenCalledWith('Ethereal preview for ops@example.com: https://ethereal.email/message/abc');
      expect(log).toHaveBeenCalledTimes(2);
    });

    it('retries creating the account after a failure', async () => {
      mocked.createTestAccount.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND api.nodemailer.com'));
      const mailer = createMailer(testConfig, { log: vi.fn() });

      await expect(mailer.sendMail('ops@example.com', digest)).rejects.toThrow('ENOTFOUND');
      await mailer.sendMail('ops@example.com', digest);

      expect(mocked.createTestAccount).toHaveBeenCalledTimes(2);
      expect(transporter.sendMail).toHaveBeenCalledOnce();
    });
  });
});
