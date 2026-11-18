import express from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();

export function feedbackConfig(env) {
  if (!env.WA_WEBHOOK_VERIFY_TOKEN && !env.WA_APP_SECRET) return null;
  if (
    !env.WA_WEBHOOK_VERIFY_TOKEN ||
    !env.WA_APP_SECRET ||
    !/^\d+$/.test(env.WA_PHONE_NUMBER_ID || '')
  ) {
    throw new Error(
      'Configure WA_WEBHOOK_VERIFY_TOKEN, WA_APP_SECRET and WA_PHONE_NUMBER_ID together.',
    );
  }
  return {
    token: env.WA_WEBHOOK_VERIFY_TOKEN,
    secret: env.WA_APP_SECRET,
    phoneNumberId: env.WA_PHONE_NUMBER_ID,
  };
}

const list = (value) => (Array.isArray(value) ? value : []);
const messageId = (value) => typeof value === 'string' && /^[!-~]{1,255}$/.test(value);

export function feedbackMessages(payload, phoneNumberId) {
  if (payload?.object !== 'whatsapp_business_account') return [];
  const messages = [];
  for (const entry of list(payload.entry)) {
    for (const change of list(entry?.changes)) {
      const value = change?.value;
      if (change?.field !== 'messages' || value?.metadata?.phone_number_id !== phoneNumberId)
        continue;
      for (const item of list(value.messages)) {
        const body = item?.text?.body;
        if (
          item?.type !== 'text' ||
          !messageId(item.id) ||
          typeof item.from !== 'string' ||
          !/^\d{1,32}$/.test(item.from) ||
          typeof body !== 'string' ||
          !body.trim() ||
          body.length > 4096
        )
          continue;
        const replyTo = item.context?.id;
        messages.push([item.id, item.from, body, messageId(replyTo) ? replyTo : null]);
      }
    }
  }
  return messages;
}

export async function storeFeedback(pool, messages) {
  if (messages.length) {
    await pool.query(
      `INSERT INTO whatsapp_feedback (message_id,sender,message,reply_to) VALUES ?
      ON DUPLICATE KEY UPDATE message_id=whatsapp_feedback.message_id`,
      [messages],
    );
  }
}

export function installFeedbackWebhook(app, pool, config) {
  if (!config) return;
  const path = '/webhooks/whatsapp';
  app.get(path, (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (
      mode !== 'subscribe' ||
      typeof token !== 'string' ||
      typeof challenge !== 'string' ||
      !timingSafeEqual(digest(token), digest(config.token))
    )
      return res.sendStatus(403);
    res.type('text').send(challenge);
  });
  app.post(
    path,
    express.raw({ type: 'application/json', limit: '1mb', inflate: false }),
    async (req, res) => {
      const signature = req.get('x-hub-signature-256') || '';
      if (!Buffer.isBuffer(req.body) || !/^sha256=[0-9a-f]{64}$/i.test(signature))
        return res.sendStatus(403);
      const expected = createHmac('sha256', config.secret).update(req.body).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex')))
        return res.sendStatus(403);
      let payload;
      try {
        payload = JSON.parse(req.body);
      } catch {
        return res.sendStatus(400);
      }
      await storeFeedback(pool, feedbackMessages(payload, config.phoneNumberId));
      res.sendStatus(200);
    },
  );
}
