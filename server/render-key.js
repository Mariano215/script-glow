// A finished render is found again by a digest of everything that decides its sound: the lines as
// spoken, the voices heard, the role, the pause and the directions switch. The whole text was the
// key before, up to 1.2 MB for a full script, and project.json keeps up to 200 of them.
// The page and the server both make it here, so the server can check the key matches the render.
// Two 53-bit passes with different seeds (cyrb53). Not for security: a key only names a cache entry.
function cyrb53(text, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
export const DIGEST = /^r1-[0-9a-f]{28}$/;
// The fields are put in one fixed order first, so the page's object and the server's give the same text.
export function renderDigest({ scene, voices, myCharacter, gapSeconds, includeDirections, scope }) {
  const text = JSON.stringify({ scene, voices, myCharacter, gapSeconds, includeDirections, scope: scope ?? 'scene' });
  return `r1-${cyrb53(text, 1)}${cyrb53(text, 2)}`;
}
