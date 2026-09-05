import { isTest } from './env.js';

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

let transport: MailTransport = consoleTransport;

export function getMailTransport(): MailTransport {
  return transport;
}

/** Test seam, and where T-043 will install the real transport at boot. */
export function setMailTransport(next: MailTransport): void {
  transport = next;
}
