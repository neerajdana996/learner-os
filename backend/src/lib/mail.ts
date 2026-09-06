import nodemailer from 'nodemailer';
import { env, isTest } from './env.js';

/**
 * Outbound email behind one interface so T-043 can drop in Resend/SMTP without
 * touching any caller. Dev and test use the console transport; nothing in the
 * pilot sends real mail until that task lands.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(mail: Mail): Promise<void>;
}

export const consoleTransport: MailTransport = {
  async send(mail) {
    // Silent under test: the suites assert on the token row, not on stdout, and
    // printing a magic link per test drowns the runner output.
    if (isTest) return;
    console.log(`\n--- mail to ${mail.to} ---\n${mail.subject}\n\n${mail.text}\n---\n`);
  },
};

/**
 * Real SMTP (Mailgun in the pilot). Built lazily on first send so importing
 * this module never opens a connection — the same reason the BullMQ queue is
 * lazily constructed in workers/queue.ts.
 */
export function createSmtpTransport(): MailTransport {
  let client: nodemailer.Transporter | null = null;

  return {
    async send(mail) {
      client ??= nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
      await client.sendMail({
        from: env.MAIL_FROM,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
    },
  };
}

let transport: MailTransport = consoleTransport;

export function getMailTransport(): MailTransport {
  return transport;
}

/** Test seam, and where `index.ts` installs the real transport at boot. */
export function setMailTransport(next: MailTransport): void {
  transport = next;
}

/**
 * Chooses the transport for this process. Real mail is opt-in: it requires an
 * SMTP host *and* a non-test environment, so a suite that forgets to stub
 * cannot mail a learner. Called once from `index.ts`, never at import time.
 */
export function configureMailTransport(): MailTransport {
  if (env.SMTP_HOST && !isTest) {
    transport = createSmtpTransport();
    console.log(`mail: sending via ${env.SMTP_HOST} as ${env.MAIL_FROM}`);
  } else {
    transport = consoleTransport;
    console.log('mail: console transport (set SMTP_HOST to send real mail)');
  }
  return transport;
}
