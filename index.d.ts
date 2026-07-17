// Type definitions for @ipseonet/sails-hook-mail

export interface MailerConfig {
  transport: 'resend' | 'sendgrid' | 'smtp' | 'log'
  apiKey?: string
  host?: string
  port?: number
  secure?: boolean
  auth?: { user?: string; pass?: string }
}

export interface MailMessage {
  to: string
  subject?: string
  html?: string
  text?: string
  from: string
  fromName?: string
  replyTo?: string
  cc?: string | string[]
  bcc?: string | string[]
  headers?: Record<string, string>
  attachments?: unknown[]
}

export interface SendDeps {
  log?: (...args: unknown[]) => void
  resend?: unknown
  sgMail?: unknown
  nodemailer?: unknown
  smtpTransport?: unknown
}

export interface SendResult {
  transport: string
  id?: string
}

export class MailError extends Error {
  code: 'MAIL_SEND_FAILED' | 'MAIL_CONFIG'
}

/** Send one already-rendered message via the given mailer config block. */
export function sendMail(msg: MailMessage, mailer: MailerConfig, deps?: SendDeps): Promise<SendResult>

/** The Sails helper definition furnished as `sails.helpers.mail.send`. */
export const sendHelperDef: unknown

/** Default export: the Sails hook factory. */
declare function defineMailHook(sails: unknown): { initialize(done: (err?: Error) => void): void }
export default defineMailHook
