'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sendMail, MailError } = require('../lib/send')

const baseMsg = {
  to: 'nola@example.com',
  subject: 'Hello',
  html: '<p>Hi</p>',
  from: 'noreply@ipseonet.com',
  fromName: 'IPSEONET'
}

test('resend: sends and returns provider id', async () => {
  let captured
  const resend = {
    emails: {
      send: async (payload) => {
        captured = payload
        return { data: { id: 'res_123' }, error: null }
      }
    }
  }
  const out = await sendMail(baseMsg, { transport: 'resend', apiKey: 'k' }, { resend })
  assert.equal(out.transport, 'resend')
  assert.equal(out.id, 'res_123')
  assert.equal(captured.from, 'IPSEONET <noreply@ipseonet.com>')
  assert.equal(captured.to, 'nola@example.com')
  assert.equal(captured.html, '<p>Hi</p>')
})

test('resend: from without fromName is a bare address', async () => {
  let captured
  const resend = { emails: { send: async (p) => ((captured = p), { data: { id: 'x' } }) } }
  await sendMail({ ...baseMsg, fromName: undefined }, { transport: 'resend', apiKey: 'k' }, { resend })
  assert.equal(captured.from, 'noreply@ipseonet.com')
})

test('resend: throws MailError when provider returns error', async () => {
  const resend = { emails: { send: async () => ({ error: { message: 'domain not verified' } }) } }
  await assert.rejects(
    () => sendMail(baseMsg, { transport: 'resend', apiKey: 'k' }, { resend }),
    (e) => e instanceof MailError && /domain not verified/.test(e.message)
  )
})

test('resend: missing apiKey is a config error', async () => {
  await assert.rejects(
    () => sendMail(baseMsg, { transport: 'resend' }, {}),
    (e) => e instanceof MailError && e.code === 'MAIL_CONFIG'
  )
})

test('sendgrid: disables click tracking and passes name+email from', async () => {
  let captured
  const sgMail = {
    setApiKey() {},
    send: async (p) => {
      captured = p
      return [{ headers: { 'x-message-id': 'sg_9' } }]
    }
  }
  const out = await sendMail(baseMsg, { transport: 'sendgrid', apiKey: 'k' }, { sgMail })
  assert.equal(out.transport, 'sendgrid')
  assert.equal(out.id, 'sg_9')
  assert.deepEqual(captured.from, { email: 'noreply@ipseonet.com', name: 'IPSEONET' })
  assert.equal(captured.trackingSettings.clickTracking.enable, false)
  assert.equal(captured.trackingSettings.clickTracking.enableText, false)
})

test('sendgrid: surfaces nested API error detail', async () => {
  const sgMail = {
    setApiKey() {},
    send: async () => {
      const err = new Error('Bad Request')
      err.response = { body: { errors: [{ message: 'from address not verified' }] } }
      throw err
    }
  }
  await assert.rejects(
    () => sendMail(baseMsg, { transport: 'sendgrid', apiKey: 'k' }, { sgMail }),
    (e) => e instanceof MailError && /from address not verified/.test(e.message)
  )
})

test('smtp: uses injected transport and returns messageId', async () => {
  let captured
  const smtpTransport = {
    sendMail: async (p) => ((captured = p), { messageId: '<abc@smtp>' })
  }
  const out = await sendMail(baseMsg, { transport: 'smtp', host: 'h', port: 587 }, { smtpTransport })
  assert.equal(out.transport, 'smtp')
  assert.equal(out.id, '<abc@smtp>')
  assert.deepEqual(captured.from, { name: 'IPSEONET', address: 'noreply@ipseonet.com' })
})

test('log: logs and returns without a transport client', async () => {
  const lines = []
  const out = await sendMail(baseMsg, { transport: 'log' }, { log: (s) => lines.push(s) })
  assert.equal(out.transport, 'log')
  assert.equal(out.id, undefined)
  assert.ok(lines.join('\n').includes('nola@example.com'))
})

test('unknown transport is a config error', async () => {
  await assert.rejects(
    () => sendMail(baseMsg, { transport: 'carrier-pigeon' }, {}),
    (e) => e instanceof MailError && e.code === 'MAIL_CONFIG'
  )
})

test('missing recipient is a config error', async () => {
  await assert.rejects(
    () => sendMail({ ...baseMsg, to: undefined }, { transport: 'log' }, {}),
    (e) => e instanceof MailError && e.code === 'MAIL_CONFIG'
  )
})

test('optional fields (cc/bcc/replyTo/headers) only appear when set', async () => {
  let captured
  const resend = { emails: { send: async (p) => ((captured = p), { data: { id: 'x' } }) } }
  await sendMail(baseMsg, { transport: 'resend', apiKey: 'k' }, { resend })
  assert.equal('cc' in captured, false)
  assert.equal('bcc' in captured, false)
  assert.equal('replyTo' in captured, false)
  assert.equal('headers' in captured, false)

  await sendMail(
    { ...baseMsg, cc: ['c@example.com'], replyTo: 'r@example.com', headers: { 'X-Env': 'test' } },
    { transport: 'resend', apiKey: 'k' },
    { resend }
  )
  assert.deepEqual(captured.cc, ['c@example.com'])
  assert.equal(captured.replyTo, 'r@example.com')
  assert.deepEqual(captured.headers, { 'X-Env': 'test' })
})
