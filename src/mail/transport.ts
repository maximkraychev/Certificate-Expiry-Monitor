import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config';
import type { SendMail } from './digest';

export interface Mailer {
  sendMail: SendMail;
  /** Closes the SMTP connection, if one was opened. */
  close(): void;
}

/**
 * SMTP from config, or an Ethereal test account when `SMTP_HOST` is empty (decision 9). With Ethereal,
 * each message's preview URL is logged. The Ethereal account is created on the first send, so starting the
 * app needs no network, and a failed attempt is retried on the next send.
 */
export function createMailer(config: Config, log: Pick<Console, 'log'> = console): Mailer {
  const useEthereal = config.smtp.host === '';
  let transporter: Promise<Transporter> | undefined;

  const getTransporter = () => {
    transporter ??= (useEthereal ? createEtherealTransport() : Promise.resolve(createSmtpTransport(config))).catch(
      (err: unknown) => {
        transporter = undefined;
        throw err;
      },
    );
    return transporter;
  };

  return {
    async sendMail(to, digest) {
      const info = await (await getTransporter()).sendMail({
        from: config.mailFrom,
        to,
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
      });
      if (useEthereal) {
        log.log(`Ethereal preview for ${to}: ${nodemailer.getTestMessageUrl(info)}`);
      }
    },
    close() {
      transporter?.then((t) => t.close(), () => {});
    },
  };
}

function createSmtpTransport({ smtp }: Config): Transporter {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 is implicit TLS; other ports (587, 25) upgrade with STARTTLS.
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
}

async function createEtherealTransport(): Promise<Transporter> {
  const account = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
}
