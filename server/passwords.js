const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const HASH_BYTES = 64;
const SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 8;

function validatePasswordInput(password) {
  if (typeof password !== 'string') {
    return 'Password is required';
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  return null;
}

async function hashPassword(password) {
  const validationError = validatePasswordInput(password);
  if (validationError) {
    throw new Error(validationError);
  }

  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = await scrypt(password, salt, HASH_BYTES);
  return `${salt}:${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof password !== 'string') {
    return false;
  }

  const [salt, expectedHex] = String(storedHash).split(':');
  if (!salt || !expectedHex) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const derivedKey = await scrypt(password, salt, expectedBuffer.length);
  const derivedBuffer = Buffer.from(derivedKey);

  if (expectedBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, derivedBuffer);
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  validatePasswordInput
};
