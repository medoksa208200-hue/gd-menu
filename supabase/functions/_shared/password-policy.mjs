export function passwordChecks(value) {
  const password = typeof value === 'string' ? value : '';
  return {
    length: password.length >= 8 && password.length <= 128,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^\p{L}\p{N}\s]/u.test(password),
  };
}
export function validPassword(value) {
  return typeof value === 'string' && Object.values(passwordChecks(value)).every(Boolean);
}
