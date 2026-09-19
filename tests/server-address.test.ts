import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServerHost } from '../src/server-address.ts';

test('parseServerHost accepts a bare host, a scheme, a port and path to drop, and a bracketed IPv6 literal', () => {
  assert.deepEqual(parseServerHost('192.168.1.20'), { scheme: 'http', host: '192.168.1.20' });
  assert.deepEqual(parseServerHost('http://192.168.1.20'), { scheme: 'http', host: '192.168.1.20' });
  assert.deepEqual(parseServerHost('http://192.168.1.20:8095'), { scheme: 'http', host: '192.168.1.20' });
  assert.deepEqual(parseServerHost('https://192.168.1.20:8095'), { scheme: 'https', host: '192.168.1.20' });
  assert.deepEqual(parseServerHost('  10.0.0.5  '), { scheme: 'http', host: '10.0.0.5' });
  assert.deepEqual(parseServerHost('studio-mac.local'), { scheme: 'http', host: 'studio-mac.local' });
  assert.deepEqual(parseServerHost('[::1]'), { scheme: 'http', host: '[::1]' });
  assert.deepEqual(parseServerHost('http://[::1]:8095'), { scheme: 'http', host: '[::1]' });
});

test('parseServerHost rejects empty, invalid, and non-host input', () => {
  for (const input of ['', '   ', 'not a host', '::1', 'http://', 'ftp://192.168.1.20', 'http://user:pass@192.168.1.20', 'http://192.168.1.20/path', 'http://192.168.1.20?x=1', 'javascript:alert(1)']) {
    assert.equal(parseServerHost(input), null, input);
  }
});
