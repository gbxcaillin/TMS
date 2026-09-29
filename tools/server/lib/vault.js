// Encryption at rest, the same scheme and key as the CRM (crm/server/lib/vault.js): AES-256-GCM, versioned keys
// from DATA_KEYS ("v2:<base64>,v1:<base64>", first = current). Sealed text looks like "v1:<base64>".
import crypto from 'node:crypto';

const keys = new Map(); let current = null;
for (const part of (process.env.DATA_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const m = /^(v\d+):(.+)$/.exec(part); if (!m) throw new Error('DATA_KEYS entry must look like v1:<base64>');
  const k = Buffer.from(m[2], 'base64'); if (k.length !== 32) throw new Error(`DATA_KEYS ${m[1]} must be 32 bytes (base64)`);
  keys.set(m[1], k); if (!current) current = m[1];
}
const SEALED = /^(v\d+):([A-Za-z0-9+/=]+)$/;
export const enabled = () => !!current;

export function sealBuf(buf) {
  if (!current) return buf;
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keys.get(current), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from(current.padEnd(8, ' ')), iv, c.getAuthTag(), ct]);
}
export function openBuf(buf, sealed) {
  if (!sealed) return buf;
  const ver = buf.subarray(0, 8).toString().trim(); const key = keys.get(ver); if (!key) throw new Error(`No key for ${ver} in DATA_KEYS`);
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(8, 20)); d.setAuthTag(buf.subarray(20, 36));
  return Buffer.concat([d.update(buf.subarray(36)), d.final()]);
}
export function seal(text) {
  if (text == null || !current) return text;
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keys.get(current), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `${current}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
export function open(stored) {
  if (stored == null) return stored;
  const m = SEALED.exec(stored); if (!m) return stored;
  const key = keys.get(m[1]); if (!key) throw new Error(`No key for ${m[1]} in DATA_KEYS`);
  const buf = Buffer.from(m[2], 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
