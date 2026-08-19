import crypto from 'crypto';

const FINGERPRINT_SALT = process.env.FINGERPRINT_SALT || '';

export function buildFingerprint(ip, userAgent) {
  const normalizedIp = typeof ip === 'string' ? ip.trim() : '';
  const normalizedAgent = typeof userAgent === 'string' ? userAgent.trim() : '';
  if (!normalizedIp && !normalizedAgent) return '';
  const payload = `${normalizedIp}|${normalizedAgent}`;
  if (FINGERPRINT_SALT) {
    return crypto.createHmac('sha256', FINGERPRINT_SALT).update(payload).digest('hex');
  }
  return crypto.createHash('sha256').update(payload).digest('hex');
}
