export function staffIdentity(username, projectUrl) {
  const normalized = String(username).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalized)) throw new Error('Invalid username');
  const host = new URL(projectUrl).hostname;
  if (!host || host.endsWith('.invalid')) throw new Error('Invalid project hostname');
  return `${normalized}@${host}`;
}
