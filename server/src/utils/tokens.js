import crypto from 'crypto';

export function createToken(size = 8) {
  return crypto.randomBytes(size).toString('hex');
}

const PASSCODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createPasscode(length = 5) {
  const bytes = crypto.randomBytes(length);
  let code = '';

  for (let i = 0; i < length; i += 1) {
    code += PASSCODE_ALPHABET[bytes[i] % PASSCODE_ALPHABET.length];
  }

  return code;
}

export function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}
