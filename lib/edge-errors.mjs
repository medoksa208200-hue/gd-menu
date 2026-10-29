export async function edgeErrorMessage(error, data) {
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (typeof payload?.error === 'string' && payload.error) return payload.error;
    } catch {}
  }
  return data?.error || error?.message || 'تعذّر إتمام العملية. حاول مرة أخرى.';
}
