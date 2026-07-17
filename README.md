# @ipseonet/sails-hook-mail

Send transactional email from a [Sails](https://sailsjs.com) app via **Resend**, **SendGrid**, **SMTP**, or a **`log`** transport for development — backed by a small, framework-agnostic, unit-tested transport core.

Maintained by [IPSEONET LLC](https://ipseonet.com).

## Why

Most Sails mail hooks couple transport selection, SDK lifecycles, and template rendering together. This one splits them:

- **`lib/send.js`** — a pure `sendMail(msg, mailer, deps)` function. No Sails, no template engine, no hidden globals beyond per-process SDK client caches. Inject fake clients to test it.
- **`index.js`** — a thin Sails hook that furnishes `sails.helpers.mail.send`, adds `sails.renderView` template rendering, and reads transport settings from `sails.config.mail`.

It also disables SendGrid click-tracking by default, so link-scanning email gateways can't silently consume single-use magic links.

## Install

```bash
npm install @ipseonet/sails-hook-mail
```

Transport SDKs are **optional** — install only the one(s) you use:

```bash
npm install resend            # for the 'resend' transport
npm install @sendgrid/mail    # for the 'sendgrid' transport
npm install nodemailer        # for the 'smtp' transport
```

## Configure

`config/mail.js`:

```js
module.exports.mail = {
  default: process.env.NODE_ENV === 'production' ? 'resend' : 'log',
  from: { address: 'noreply@example.com', name: 'Example' },
  mailers: {
    resend:   { transport: 'resend',   apiKey: process.env.RESEND_API_KEY },
    sendgrid: { transport: 'sendgrid', apiKey: process.env.SENDGRID_API_KEY },
    smtp:     { transport: 'smtp', host: 'smtp.example.com', port: 587, secure: false,
                auth: { user: '...', pass: '...' } },
    log:      { transport: 'log' }
  }
}
```

## Use

As a hook helper (renders `views/emails/<template>.ejs` inside `views/layouts/layout-email.ejs`):

```js
await sails.helpers.mail.send.with({
  to: 'user@example.com',
  subject: 'Welcome',
  template: 'welcome',
  templateData: { name: 'Ada' }
})
```

Or call the core directly with your own rendered HTML:

```js
const { sendMail } = require('@ipseonet/sails-hook-mail')

await sendMail(
  { to: 'user@example.com', subject: 'Welcome', html, from: 'noreply@example.com', fromName: 'Example' },
  sails.config.mail.mailers.resend
)
```

`sendMail` returns `{ transport, id }` and throws a `MailError` (`code: 'MAIL_SEND_FAILED' | 'MAIL_CONFIG'`) on failure.

## License

MIT © IPSEONET LLC
