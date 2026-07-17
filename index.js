'use strict'

// @ipseonet/sails-hook-mail
//
// A Sails hook that furnishes `sails.helpers.mail.send`, with native support
// for Resend, SendGrid, SMTP, and a `log` transport for development. Transport
// dispatch lives in ./lib/send.js (framework-agnostic + unit-tested); this hook
// layers on Sails template rendering (`sails.renderView`) and reads transport
// settings from `sails.config.mail`.
//
// Config shape (config/mail.js):
//   module.exports.mail = {
//     default: 'resend',                       // mailer name, or 'log'
//     from: { address, name },
//     mailers: {
//       resend:   { transport: 'resend',   apiKey },
//       sendgrid: { transport: 'sendgrid', apiKey },
//       smtp:     { transport: 'smtp', host, port, secure, auth: { user, pass } },
//       log:      { transport: 'log' }
//     }
//   }
//
// Usage:
//   await sails.helpers.mail.send.with({ to, subject, template, templateData })
//
// The core sender is also exported for callers that render their own HTML:
//   const { sendMail } = require('@ipseonet/sails-hook-mail')

const path = require('node:path')
const { sendMail, MailError } = require('./lib/send')

const sendHelperDef = {
  friendlyName: 'Send',
  description: 'Send a transactional email via the configured mailer.',

  inputs: {
    to: { type: 'string', required: true, isEmail: true },
    subject: { type: 'string', defaultsTo: '' },
    template: {
      type: 'string',
      description: 'Path to an EJS template under `views/emails/`, without extension (e.g. "reset-password").'
    },
    templateData: { type: {}, defaultsTo: {} },
    html: { type: 'string', description: 'Pre-rendered HTML. If given, `template` is ignored.' },
    text: { type: 'string' },
    layout: {
      description: 'Layout under `views/layouts/` (without extension), or false to disable.',
      defaultsTo: 'layout-email',
      custom: (l) => l === false || typeof l === 'string'
    },
    mailer: { type: 'string', description: 'Override the default mailer name.' },
    from: { type: 'string', isEmail: true },
    fromName: { type: 'string' },
    replyTo: { type: 'string' },
    cc: { type: 'ref', defaultsTo: [] },
    bcc: { type: 'ref', defaultsTo: [] },
    headers: { type: 'ref', defaultsTo: {} },
    attachments: { type: 'ref', defaultsTo: [] }
  },

  exits: {
    success: { outputFriendlyName: 'Send result' },
    failed: { description: 'The email could not be sent.' }
  },

  fn: async function (inputs, exits) {
    const mailConfig = sails.config.mail || {}
    const mailerName = inputs.mailer || mailConfig.default
    const mailer = (mailConfig.mailers || {})[mailerName]

    if (!mailer) {
      return exits.failed(new MailError(`No mailer named "${mailerName}" in sails.config.mail.mailers.`, 'MAIL_CONFIG'))
    }

    let html = inputs.html
    if (!html && inputs.template) {
      const templatePath = path.join('emails/', inputs.template)
      const layout = inputs.layout
        ? path.relative(path.dirname(templatePath), path.resolve('layouts/', inputs.layout))
        : false
      try {
        html = await sails.renderView(templatePath, { layout, ...inputs.templateData })
      } catch (err) {
        return exits.failed(new MailError(`Could not render template "${inputs.template}": ${err.message}`, 'MAIL_CONFIG'))
      }
    }

    const from = inputs.from || (mailConfig.from && mailConfig.from.address)
    const fromName = inputs.fromName || (mailConfig.from && mailConfig.from.name)

    try {
      const result = await sendMail(
        {
          to: inputs.to,
          subject: inputs.subject,
          html,
          text: inputs.text,
          from,
          fromName,
          replyTo: inputs.replyTo,
          cc: inputs.cc,
          bcc: inputs.bcc,
          headers: inputs.headers,
          attachments: inputs.attachments
        },
        mailer,
        { log: sails.log.debug.bind(sails.log) }
      )
      return exits.success(result)
    } catch (err) {
      return exits.failed(err)
    }
  }
}

module.exports = function defineMailHook(sails) {
  return {
    initialize: function (done) {
      if (!sails.hooks.helpers) {
        return done(new Error('Cannot load @ipseonet/sails-hook-mail without the "helpers" hook enabled.'))
      }
      sails.after('hook:helpers:loaded', function () {
        try {
          sails.hooks.helpers.furnishHelper('mail.send', sendHelperDef)
        } catch (err) {
          return done(err)
        }
        return done()
      })
    }
  }
}

// Expose the core sender + the raw helper def for direct/testing use.
module.exports.sendMail = sendMail
module.exports.MailError = MailError
module.exports.sendHelperDef = sendHelperDef
