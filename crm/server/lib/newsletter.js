'use strict';
// Branded newsletter: structured content in, email-safe HTML out (tables, inline styles, web
// fonts with system fallbacks), matching brightday.com.au. Personalisation tokens are left in place for
// mailing.sendBulk: {{name}} and {{unsubscribe}} (the per-recipient link goes in the footer).
const claude = require('./claude');

const BRAND = 'Brightday';
// The approved logo (light version, for the paper email surface), served from the public website so it loads for every recipient.
const LOGO = process.env.MAIL_LOGO_URL || 'https://brightday.com.au/media/logo-light-email.png';
const SITE = 'https://brightday.com.au';
const ADDRESS = '260 Spencer Street, Melbourne VIC 3000';
const ABN = '45 674 252 905';
const C = { bg: '#F4F6FA', paper: '#FFFFFF', ink: '#123559', ink2: '#3D5573', ink3: '#7A8BA3', line: '#E4DFD3', teal: '#990A4E', teal2: '#F50D74' };
const SERIF = "'Ubuntu', Georgia, 'Times New Roman', serif";
const SANS = "'Manrope', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const url = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');
// Plain text with blank-line paragraphs -> <p> blocks. Single newlines become <br>.
const paras = (t, style) => String(t || '').trim().split(/\n\s*\n/).filter(Boolean).map((p) => `<p style="${style}">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

// Normalise whatever the editor sends into a safe, bounded structure.
function clean(d = {}) {
  const sections = (Array.isArray(d.sections) ? d.sections : []).slice(0, 4).map((s) => ({ title: String(s.title || '').slice(0, 120), body: String(s.body || '').slice(0, 3000), url: url(s.url), linkText: String(s.linkText || '').slice(0, 60) })).filter((s) => s.title || s.body);
  return {
    subject: String(d.subject || '').slice(0, 150),
    preheader: String(d.preheader || '').slice(0, 150),
    headline: String(d.headline || '').slice(0, 150),
    intro: String(d.intro || '').slice(0, 3000),
    sections,
    cta: { label: String((d.cta && d.cta.label) || 'Book a call').slice(0, 60), url: url(d.cta && d.cta.url) || SITE + '/book/' },
    signoff: { name: String((d.signoff && d.signoff.name) || '').slice(0, 80), role: String((d.signoff && d.signoff.role) || '').slice(0, 80) },
    date: d.date ? String(d.date).slice(0, 40) : new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
  };
}

function render(input) {
  const d = clean(input);
  const pStyle = `margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.ink}`;
  const sections = d.sections.map((s) => `
<tr><td style="padding:0 32px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${C.line};padding-top:22px">
${s.title ? `<h2 style="margin:0 0 10px;font-family:${SERIF};font-weight:400;font-size:24px;line-height:1.25;color:${C.ink}">${esc(s.title)}</h2>` : ''}
${paras(s.body, pStyle)}
${s.url ? `<p style="margin:0 0 20px;font-family:${SANS};font-size:14px"><a href="${esc(s.url)}" style="color:${C.teal};font-weight:600;text-decoration:none">${esc(s.linkText || 'Read more')} &rarr;</a></p>` : '<div style="height:8px"></div>'}
</td></tr></table></td></tr>`).join('');
  const signoff = d.signoff.name ? `<tr><td style="padding:6px 32px 0"><p style="margin:0;font-family:${SERIF};font-size:20px;font-style:italic;color:${C.ink}">${esc(d.signoff.name)}</p>${d.signoff.role ? `<p style="margin:2px 0 0;font-family:${SANS};font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${C.ink2}">${esc(d.signoff.role)}</p>` : ''}</td></tr>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${esc(d.headline || d.subject || BRAND)}</title>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:ital,wght@0,400;0,500;0,700;1,400&family=Manrope:wght@400;500;600;700&family=Ubuntu+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>@media (max-width:620px){.wrap{padding:12px 6px!important}.card{border-left:0!important;border-right:0!important}.pad{padding-left:20px!important;padding-right:20px!important}.date{display:none!important}}</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
${d.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(d.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="wrap" style="background:${C.bg};padding:32px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="card" style="max-width:600px;width:100%;background:${C.paper};border:1px solid ${C.line}">
<tr><td class="pad" style="padding:24px 32px;border-bottom:1px solid ${C.line}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td><a href="${SITE}" style="text-decoration:none"><img src="${LOGO}" width="64" height="64" alt="${BRAND}" style="display:block;border:0;width:64px;height:64px"></a></td>
<td align="right" class="date" style="font-family:${SANS};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.ink3};white-space:nowrap">${esc(d.date)}</td>
</tr></table></td></tr>
<tr><td class="pad" style="padding:36px 32px 8px">
${d.headline ? `<h1 style="margin:0 0 18px;font-family:${SERIF};font-weight:300;font-size:34px;line-height:1.15;color:${C.ink}">${esc(d.headline)}</h1>` : ''}
${paras(d.intro, pStyle)}
</td></tr>
${sections}
<tr><td class="pad" style="padding:10px 32px 34px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.teal};border-radius:2px"><a href="${esc(d.cta.url)}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.paper};text-decoration:none">${esc(d.cta.label)}</a></td></tr></table></td></tr>
${signoff}
<tr><td class="pad" style="padding:28px 32px 26px;border-top:1px solid ${C.line}"><p style="margin:0 0 6px;font-family:${SERIF};font-size:16px;font-style:italic;color:${C.ink2}">Every client, meeting and task. In one place.</p><p style="margin:0 0 10px;font-family:${SANS};font-size:11px;line-height:1.6;color:${C.ink3}">${BRAND} &middot; ${ADDRESS} &middot; ABN ${ABN}<br><a href="${SITE}" style="color:${C.ink3}">brightday.com.au</a></p><p style="margin:0;font-family:${SANS};font-size:11px;line-height:1.6;color:${C.ink3}">You are receiving this because you subscribed at brightday.com.au. <a href="{{unsubscribe}}" style="color:${C.ink3}">Unsubscribe</a></p></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// A starter issue when Claude is off, built around the site's own resources.
function templateData(topic, sender) {
  const t = String(topic || '').trim();
  return {
    subject: t ? `${t}: a few practical notes` : 'A few practical notes from BD',
    preheader: 'Three short ideas you can use this month, and a quick way to talk them through.',
    headline: t || 'What we are seeing this month',
    intro: `Hi {{name}},\n\nA short note with a few things that have come up in our work recently${t ? ' around ' + t : ''}. Nothing to sell here, just the practical bits that might save you some time.`,
    sections: [
      { title: 'Start with one number', body: 'Most businesses track too much and act on too little. Pick the one figure that best predicts next month, put a name next to it, and review it weekly. Everything else can wait until that habit sticks.', url: SITE + '/tools', linkText: 'Get a quick read with our free tools' },
      { title: 'Where the capacity usually hides', body: 'When we map how a week is actually spent, the recurring finding is that senior people do work that could be handed down or automated. Freeing even four hours a week is usually worth more than a new hire.', url: SITE + '/services', linkText: 'How we approach it' },
      { title: 'A question worth asking your team', body: '"What do we do every week that nobody would miss?" It is uncomfortable, and it is the fastest route to the low-hanging fruit.' },
    ],
    cta: { label: 'Book a 20-minute call', url: SITE + '/book/' },
    signoff: { name: sender.name || '', role: sender.role || BRAND },
  };
}
async function draft({ topic, notes, sender = {} }) {
  if (!claude.enabled()) return { data: templateData(topic, sender), via: 'template' };
  const prompt = [
    `You write the client newsletter for ${BRAND} (professional services and workplace financial education for businesses of any kind, Australia). Author: ${sender.name || 'the BD team'}.`,
    `Write one issue${topic ? ' about: ' + topic : ''}.${notes ? ' Notes from the author: ' + String(notes).slice(0, 1500) : ''}`,
    'Voice: warm, specific, practical, no hype, Australian English, short paragraphs. Open the intro with "Hi {{name}}," on its own line. Three sections, each 60 to 110 words with a concrete takeaway. Links only to brightday.com.au pages (https://brightday.com.au/tools, https://brightday.com.au/services, https://brightday.com.au/book/) or none.',
    'Return ONLY compact JSON, no prose, no code fences: {"subject":"...","preheader":"<under 90 chars>","headline":"...","intro":"...","sections":[{"title":"...","body":"...","url":"","linkText":""}],"cta":{"label":"Book a 20-minute call","url":"https://brightday.com.au/book/"}}',
  ].join('\n');
  try {
    const text = await claude.run(prompt); const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('no json');
    const j = JSON.parse(m[0]); j.signoff = { name: sender.name || '', role: sender.role || BRAND };
    const data = clean(j); if (!data.headline && !data.intro) throw new Error('empty');
    return { data, via: 'claude' };
  } catch (e) { return { data: templateData(topic, sender), via: 'template' }; }
}
module.exports = { render, clean, draft, templateData };
