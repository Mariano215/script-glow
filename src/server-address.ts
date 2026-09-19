// Turns what an actor types for "where is your voice server" into a scheme and bare host,
// dropping any port or path. Accepts a bare host or IP, a URL with a scheme, or a bracketed
// IPv6 literal like [::1]. Returns null when nothing usable was typed.
export interface ServerHost { scheme: string; host: string }

export function parseServerHost(input: string): ServerHost | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try { parsed = new URL(withScheme); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
  return { scheme: parsed.protocol.slice(0, -1), host: parsed.hostname };
}
