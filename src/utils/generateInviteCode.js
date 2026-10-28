const INVITE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const INVITE_CODE_LENGTH = 8;

export function generateInviteCode() {
  let code = '';

  while (code.length < INVITE_CODE_LENGTH) {
    const randomBytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(randomBytes);

    for (const byte of randomBytes) {
      if (byte < 252) code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
      if (code.length === INVITE_CODE_LENGTH) break;
    }
  }

  return code;
}
