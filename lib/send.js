'use strict'

// Transport core for @ipseonet/sails-hook-mail.
//
// sendMail() takes a fully-resolved message (HTML already rendered) plus a
// mailer config block, picks the transport, and sends. It is deliberately
// framework-agnostic: no Sails, no template rendering, no global state beyond
// per-process client caches. That makes it unit-testable by injecting fake
// clients via `deps`, and lets callers (a Sails hook, an app helper, a plain
// script) own template rendering however they like.
//
// Supported transports (mailer.transport): 'resend' | 'sendgrid' | 'smtp' | 'log'.
//
// Returns: { transport, id }  — id is the provider message id when available.
// Throws:  MailError (code: 'MAIL_SEND_FAILED' | 'MAIL_CONFIG') on failure.

class MailError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'MailError'
    this.code = code || 'MAIL_SEND_FAILED'
  }
}

// Per-process client caches, keyed so distinct mailers/credentials don't share
// a client. Mirrors the upstream hook's caching to avoid re-instantiating an
// SDK client on every send.
const resendClients = new Map()
const smtpTransporters = new Map()

function lazyRequire(moduleName, transport) {
  try {
    return require(moduleName)
  } catch (err) {
    throw new MailError(
      `The "${transport}" transport needs the "${moduleName}" package, but it is not installed. ` +
        `Run: npm install ${moduleName}`,
      'MAIL_CONFIG'
    )
  }
}

/**
 * Send one message.
 *
 * @param {object} msg
 * @param {string}        msg.to           primary recipient
 * @param {string}        msg.subject
 * @param {string}        msg.html         pre-rendered HTML body
 * @param {string}        [msg.text]       plain-text alternative
 * @param {string}        msg.from         from address
 * @param {string}        [msg.fromName]   from display name
 * @param {string}        [msg.replyTo]
 * @param {string[]|string} [msg.cc]
 * @param {string[]|string} [msg.bcc]
 * @param {object}        [msg.headers]    extra headers
 * @param {Array}         [msg.attachments]
 *
 * @param {object} mailer   the resolved sails.config.mail.mailers[x] block:
 *                          { transport, apiKey?, host?, port?, secure?, auth? }
 *
 * @param {object} [deps]   test seams / logging
 * @param {function} [deps.log]            log(...args) for the 'log' transport + debug
 * @param {object}   [deps.resend]         injected Resend client (skips SDK)
 * @param {object}   [deps.sgMail]         injected @sendgrid/mail (skips SDK)
 * @param {object}   [deps.smtpTransport]  injected nodemailer transport (skips SDK)
 *
 * @returns {Promise<{transport: string, id: (string|undefined)}>}
 */
async function sendMail(msg, mailer, deps = {}) {
  const log = deps.log || (() => {})

  if (!mailer || typeof mailer !== 'object' || !mailer.transport) {
    throw new MailError('No mailer transport configured.', 'MAIL_CONFIG')
  }
  if (!msg || !msg.to) {
    throw new MailError('A recipient ("to") is required.', 'MAIL_CONFIG')
  }

  const hasHeaders = msg.headers && Object.keys(msg.headers).length > 0

  switch (mailer.transport) {
    case 'resend': {
      const apiKey = mailer.apiKey
      if (!apiKey) throw new MailError('Resend transport is missing "apiKey".', 'MAIL_CONFIG')
      const resend = deps.resend || getResendClient(apiKey)
      const result = await resend.emails.send({
        from: msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
        ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
        ...(msg.cc && msg.cc.length ? { cc: msg.cc } : {}),
        ...(msg.bcc && msg.bcc.length ? { bcc: msg.bcc } : {}),
        ...(msg.attachments && msg.attachments.length ? { attachments: msg.attachments } : {}),
        ...(hasHeaders ? { headers: msg.headers } : {})
      })
      if (result && result.error) {
        throw new MailError(result.error.message || 'Resend send failed.')
      }
      const id = result && result.data ? result.data.id : undefined
      log('[mail] sent to %s via resend (id: %s)', msg.to, id)
      return { transport: 'resend', id }
    }

    case 'sendgrid': {
      const apiKey = mailer.apiKey
      if (!apiKey) throw new MailError('SendGrid transport is missing "apiKey".', 'MAIL_CONFIG')
      const sgMail = deps.sgMail || lazyRequire('@sendgrid/mail', 'sendgrid')
      sgMail.setApiKey(apiKey)
      try {
        const [resp] = await sgMail.send({
          to: msg.to,
          from: msg.fromName ? { email: msg.from, name: msg.fromName } : { email: msg.from },
          ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
          ...(msg.cc && msg.cc.length ? { cc: msg.cc } : {}),
          ...(msg.bcc && msg.bcc.length ? { bcc: msg.bcc } : {}),
          ...(msg.attachments && msg.attachments.length ? { attachments: msg.attachments } : {}),
          ...(hasHeaders ? { headers: msg.headers } : {}),
          subject: msg.subject,
          html: msg.html,
          ...(msg.text ? { text: msg.text } : {}),
          // Click tracking rewrites every link (including one-time magic links)
          // through SendGrid's redirect domain. Corporate email scanners
          // prefetch those to vet them, silently consuming single-use tokens
          // before the recipient ever opens the mail. Disable it.
          trackingSettings: { clickTracking: { enable: false, enableText: false } }
        })
        const id = resp && resp.headers ? resp.headers['x-message-id'] : undefined
        log('[mail] sent to %s via sendgrid (id: %s)', msg.to, id)
        return { transport: 'sendgrid', id }
      } catch (err) {
        const detail =
          (err.response && err.response.body && err.response.body.errors && err.response.body.errors[0] && err.response.body.errors[0].message) ||
          err.message
        throw new MailError(detail)
      }
    }

    case 'smtp': {
      const auth = mailer.auth || {}
      // Only reach for nodemailer when a transport wasn't injected — an injected
      // smtpTransport (tests, custom setups) must not require the SDK at all.
      let transporter = deps.smtpTransport
      if (!transporter) {
        const nodemailer = deps.nodemailer || lazyRequire('nodemailer', 'smtp')
        transporter = getSmtpTransporter(mailer, () =>
          nodemailer.createTransport({
            host: mailer.host,
            port: mailer.port,
            secure: mailer.secure || false,
            auth: auth.user ? { user: auth.user, pass: auth.pass } : undefined
          })
        )
      }
      const info = await transporter.sendMail({
        from: msg.fromName ? { name: msg.fromName, address: msg.from } : msg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
        ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
        ...(msg.cc && msg.cc.length ? { cc: msg.cc } : {}),
        ...(msg.bcc && msg.bcc.length ? { bcc: msg.bcc } : {}),
        ...(msg.attachments && msg.attachments.length ? { attachments: msg.attachments } : {}),
        ...(hasHeaders ? { headers: msg.headers } : {})
      })
      log('[mail] sent to %s via smtp (id: %s)', msg.to, info && info.messageId)
      return { transport: 'smtp', id: info && info.messageId }
    }

    case 'log': {
      log(
        '\n-=-=-=-=-=-=-=-= @ipseonet/sails-hook-mail (log transport) -=-=-=-=-=-=-=-=\n' +
          `To: ${msg.to}\n` +
          `Subject: ${msg.subject}\n\n` +
          `${msg.html || msg.text || ''}\n` +
          '-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=\n'
      )
      return { transport: 'log', id: undefined }
    }

    default:
      throw new MailError(`Unknown mail transport: "${mailer.transport}".`, 'MAIL_CONFIG')
  }
}

function getResendClient(apiKey) {
  if (!resendClients.has(apiKey)) {
    const { Resend } = lazyRequire('resend', 'resend')
    resendClients.set(apiKey, new Resend(apiKey))
  }
  return resendClients.get(apiKey)
}

function getSmtpTransporter(mailer, create) {
  const key = `${mailer.host}:${mailer.port}:${(mailer.auth && mailer.auth.user) || ''}`
  if (!smtpTransporters.has(key)) smtpTransporters.set(key, create())
  return smtpTransporters.get(key)
}

module.exports = { sendMail, MailError }
