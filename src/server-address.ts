// Turns what an actor types for "where is your voice server" into a scheme and bare host,
// dropping any port or path. Accepts a bare host or IP, a URL with a scheme, or a bracketed
// IPv6 literal like [::1]. Returns null when nothing usable was typed.
export interface ServerHost { scheme: string; host: string }

// A bracketed IPv6 literal, or a hostname/IPv4 made of dot-separated labels. Browsers are more
// lenient than Node's URL parser and will silently percent-encode a space instead of throwing,
// so the hostname is checked against this shape too, not just whether `new URL()` accepted it.
const HOST_RE = /^\[[0-9a-fA-F:]+\]$|^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function parseServerHost(input: string): ServerHost | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try { parsed = new URL(withScheme); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
  if (!HOST_RE.test(parsed.hostname)) return null;
  return { scheme: parsed.protocol.slice(0, -1), host: parsed.hostname };
}
