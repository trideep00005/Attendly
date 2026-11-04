export const api = async <T = any>(path: string, options: RequestInit = {}): Promise<T> => {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    if (data?.code === 'ACCOUNT_SUSPENDED' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('attendly:account-suspended', { detail: { reason: data.reason || data.error } }));
    }
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data as T;
};
export const downloadFile = async (path:string, filename:string) => {
  const response = await fetch(`/api${path}`, { credentials:'same-origin' });
  if (!response.ok) { const data=await response.json().catch(()=>({})); throw new Error(data.error || 'Download failed'); }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
};
