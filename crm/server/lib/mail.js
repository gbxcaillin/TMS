'use strict';
// Outbound email through Resend (HTTP API). Unconfigured → logged only. Other providers were
// removed in September 2026 to keep the stack lean; git history has the Postmark, SMTP and Graph
// send paths if Resend ever has to be replaced.
//
// Two identities keep reputations apart: MAIL_FROM for transactional/notify mail on the main
// domain, MAIL_CAMPAIGN_FROM for newsletters and nurture on a subdomain (e.g. news.brightday.com.au),
// so a campaign with complaints can never drag client correspondence into junk.
const { log, nowIso } = require('./db');

const env = process.env;
const cfg = {
  mode: env.RESEND_API_KEY ? 'resend' : 'off',
  from: env.MAIL_FROM || 'Brightday <no-reply@brightday.com.au>',
  campaignFrom: env.MAIL_CAMPAIGN_FROM || env.MAIL_FROM || 'Brightday <hello@brightday.com.au>',
  resendKey: env.RESEND_API_KEY,
  replyTo: env.MAIL_REPLY_TO || '',   // default Reply-To for campaign mail (the campaign address has no mailbox)
};
function enabled() { return cfg.mode === 'resend'; }

const BASE = env.APP_URL || 'https://portal.brightday.com.au';
// The approved logo (light version, for the paper email surface), hosted on the public website (the CRM sits behind Cloudflare Access, so
// recipients could not load an image served from portal.brightday.com.au).
const LOGO = env.MAIL_LOGO_URL || 'https://brightday.com.au/media/logo-light-email.png';
function layout(title, bodyHtml, cta, footer) {
  return `<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:Manrope,Segoe UI,Helvetica,Arial,sans-serif;color:#1B4470">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:28px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4DFD3">
<tr><td style="padding:20px 28px;border-bottom:1px solid #E4DFD3"><a href="https://brightday.com.au" style="text-decoration:none"><img src="${LOGO}" width="64" height="64" alt="Brightday" style="display:block;border:0;width:64px;height:64px"></a></td></tr>
<tr><td style="padding:26px 28px 8px"><h1 style="margin:0 0 12px;font-weight:400;font-size:22px;font-family:'Ubuntu',Georgia,serif">${title}</h1><div style="font-size:14px;line-height:1.55">${bodyHtml}</div></td></tr>
${cta ? `<tr><td style="padding:8px 28px 26px"><a href="${cta.url}" style="display:inline-block;background:#990A4E;color:#FFFFFF;text-decoration:none;padding:11px 18px;font-size:13px;letter-spacing:.04em">${cta.label}</a><div style="font-size:11px;color:#7A8BA3;margin-top:10px">${cta.url}</div></td></tr>` : '<tr><td style="padding:8px"></td></tr>'}
<tr><td style="padding:14px 28px;border-top:1px solid #E4DFD3;font-size:11px;color:#7A8BA3">${footer || `Brightday · Notification preferences: ${BASE}/#/settings/notifications`}</td></tr>
</table></td></tr></table></body></html>`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A plain-text alternative from HTML, so every message has a text part (a spam-filter signal).
const toText = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();

async function viaResend(from, to, subject, html, text, headers, attachments, replyTo) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.resendKey, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html, text, reply_to: replyTo || undefined, headers: headers || undefined, attachments: attachments && attachments.length ? attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) : undefined }) });
  if (!r.ok) throw new Error('resend ' + r.status + ': ' + (await r.text()).slice(0, 200));
}

// kind: 'notify' (transactional, MAIL_FROM) or 'campaign' (bulk, MAIL_CAMPAIGN_FROM).
// raw: send the given HTML as-is (pre-prepared newsletters); otherwise wrap in the app layout.
// unsubscribe: a per-recipient URL; adds RFC 8058 one-click List-Unsubscribe headers (Gmail/Yahoo/Outlook
// require them for bulk mail).
// replyTo: where replies go. Campaign mail defaults to MAIL_REPLY_TO, because hello@news.* has no mailbox.
async function send({ to, subject, title, html, text, cta, footer, attachments, raw, kind = 'notify', unsubscribe, replyTo }) {
  const body = raw ? (html || '') : layout(title || subject, html || `<p>${esc(text)}</p>`, cta, footer);
  const plain = text || toText(body) || subject;
  const from = kind === 'campaign' ? cfg.campaignFrom : cfg.from;
  const headers = unsubscribe ? { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : null;
  const reply = replyTo || (kind === 'campaign' ? cfg.replyTo : '') || '';
  if (!enabled()) { log.mail.run(nowIso(), to, subject, kind, 'skipped', 'mail not configured'); console.log(`[mail:off] to=${to} "${subject}"`); return false; }
  try {
    await viaResend(from, to, subject, body, plain, headers, attachments, reply);
    log.mail.run(nowIso(), to, subject, kind, 'sent', '');
    return true;
  } catch (e) {
    log.mail.run(nowIso(), to, subject, kind, 'failed', String(e.message || e).slice(0, 300));
    console.error('[mail] failed', to, subject, e.message);
    return false;
  }
}
module.exports = { send, enabled, esc, BASE, mode: () => cfg.mode, campaignFrom: () => cfg.campaignFrom, replyTo: () => cfg.replyTo };
