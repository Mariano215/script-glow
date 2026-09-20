// electron-builder settings. Windows signing turns on only when its settings are present, so the
// same file makes unsigned test builds. Mac signing and notarization follow the CSC_* and APPLE_*
// environment variables, which electron-builder reads by itself.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { notShipped } = require('../scripts/not-shipped.cjs');

const ROOT = path.join(__dirname, '..');
const azure = process.env.AZURE_SIGNING_ACCOUNT;

// node_modules/@napi-rs only ever holds the binding for the machine that ran `npm install`
// (here, darwin-arm64). A Mac build for the other Intel/Apple Silicon arch needs its own
// native binding, at the same @napi-rs/canvas version, unpacked alongside it.
// `npm install` (even with --no-save --os --cpu) reconciles the whole tree for that other
// platform and deletes the arm64 binding this machine needs; `npm pack` just downloads the
// one tarball and never touches node_modules or the lockfile, so that is used instead.
// npm pack only checks the registry's own metadata, so the tarball is also checked against
// the hash package-lock.json recorded, the same check `npm ci` makes.
async function ensureCanvasBinding(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { Arch } = require('electron-builder');
  const archName = Arch[context.arch];
  const pkgName = `@napi-rs/canvas-darwin-${archName}`;
  const dest = path.join(ROOT, 'node_modules', pkgName);
  const version = require('@napi-rs/canvas/package.json').version;
  const present = (() => { try { return JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version; } catch { return null; } })();
  if (present === version) return;
  const locked = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages[`node_modules/${pkgName}`];
  if (!locked?.integrity || locked.version !== version) throw new Error(`package-lock.json has no ${pkgName}@${version} entry with an integrity hash. Run npm install, then build again.`);
  console.log(`fetching ${pkgName}@${version} for the ${archName} build`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-glow-canvas-'));
  // Unpacked next to the destination, then renamed into place, so a failed copy never leaves a
  // half-filled folder that a later build would take as complete.
  const staging = `${dest}.partial`;
  try {
    // npm 11 prints a list, npm 12 an object keyed by package name.
    const packed = Object.values(JSON.parse(execFileSync('npm', ['pack', `${pkgName}@${version}`, '--pack-destination', tmpDir, '--json'], { cwd: ROOT }).toString()))[0];
    const tarball = path.join(tmpDir, packed.filename);
    const integrity = `sha512-${createHash('sha512').update(fs.readFileSync(tarball)).digest('base64')}`;
    if (integrity !== locked.integrity) throw new Error(`${pkgName}@${version} does not match package-lock.json (got ${integrity}, expected ${locked.integrity}).`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    execFileSync('tar', ['xzf', tarball, '-C', staging, '--strip-components=1']);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(staging, dest);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// The Kokoro worker runs from app.asar.unpacked, like the PDF worker, so every package it can import
// is unpacked with it (onnxruntime-node also loads native libraries, which cannot load from an
// archive). The list follows package-lock.json, so a new dependency is never missed.
function unpackedTree(...roots) {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages;
  const found = new Set(), waiting = [...roots];
  while (waiting.length) {
    const name = waiting.shift(), entry = lock[`node_modules/${name}`];
    if (found.has(name) || !entry || entry.dev) continue;
    found.add(name);
    waiting.push(...Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }));
  }
  return [...found].sort().map(name => `node_modules/${name}/**`);
}

// Playwright's electron.launch drives the app through --inspect, so the unsigned CI smoke-test
// build may keep that one fuse on. A build with signing settings is always strict.
const inspectable = process.env.SCRIPT_GLOW_INSPECTABLE_BUILD === '1';
if (inspectable && (process.env.CSC_LINK || azure)) throw new Error('SCRIPT_GLOW_INSPECTABLE_BUILD is for unsigned test builds only.');

module.exports = {
  appId: 'io.github.mariano215.scriptglow',
  productName: 'Script Glow',
  directories: { output: 'release' },
  // Left out: packages the app never loads (scripts/not-shipped.cjs), and the parts of transformers.js
  // its Node build (dist/transformers.node.mjs, what the Kokoro worker imports) never reads: the
  // browser builds, their 21 MB .wasm, source maps, TypeScript types and the unbundled source.
  files: ['desktop/**', 'server/**', 'dist/**', 'package.json', ...notShipped().map(name => `!node_modules/${name}{,/**}`),
    '!node_modules/@huggingface/transformers/{src,types}{,/**}', '!node_modules/@huggingface/transformers/dist/!(transformers.node.mjs|transformers.node.cjs)'],
  beforePack: ensureCanvasBinding,
  // No running the app binary as Node, no NODE_OPTIONS, no --inspect, and the app code only from
  // app.asar: a local program cannot borrow the app's camera and microphone access that way.
  // Flipping a fuse edits the binary, so an unsigned Mac build is signed ad hoc again or Apple
  // silicon refuses to start it. A signed build is signed properly after this step.
  electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: inspectable, onlyLoadAppFromAsar: true, resetAdHocDarwinSignature: true },
  // pdfjs-dist's legacy build needs @napi-rs/canvas (a native module) at runtime for its
  // DOMMatrix/Path2D polyfills outside a browser. The worker's own files are named directly;
  // it needs no other sibling from server/.
  asarUnpack: ['server/pdf-worker.js', 'server/pdf-text.js', 'node_modules/pdfjs-dist/**', 'node_modules/@napi-rs/**',
    'server/kokoro/**', ...unpackedTree('@huggingface/transformers', 'onnxruntime-node', 'number-to-words')],
  // Next to the app, where anyone can read it: the licenses of everything shipped or downloaded.
  extraResources: [{ from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
    { from: 'licenses/onnxruntime-1.21.0-ThirdPartyNotices.txt', to: 'onnxruntime-1.21.0-ThirdPartyNotices.txt' }],
  mac: {
    // onnxruntime-node carries its runtime for every system; each build keeps only its own.
    files: ['!node_modules/onnxruntime-node/bin/napi-v3/!(darwin){,/**}', '!node_modules/onnxruntime-node/bin/napi-v3/darwin/!(${arch}){,/**}'],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }, { target: 'zip', arch: ['arm64', 'x64'] }],
    icon: 'public/brand/script-glow-mark-v2.png',
    category: 'public.app-category.entertainment',
    hardenedRuntime: true,
    // With a Mac certificate supplied, a build that cannot find its identity has to fail instead of
    // quietly shipping an unsigned, unnotarized app (electron-builder only warns). This sits under
    // mac, so the Windows build, which is allowed to go unsigned, is not affected.
    forceCodeSigning: Boolean(process.env.CSC_LINK),
    entitlements: 'desktop/entitlements.mac.plist',
    entitlementsInherit: 'desktop/entitlements.mac.plist',
    extendInfo: {
      NSCameraUsageDescription: 'Script Glow uses the camera to record your self-tapes.',
      NSMicrophoneUsageDescription: 'Script Glow uses the microphone to record your self-tapes and your own voice.',
    },
  },
  win: {
    files: ['!node_modules/onnxruntime-node/bin/napi-v3/!(win32){,/**}', '!node_modules/onnxruntime-node/bin/napi-v3/win32/!(${arch}){,/**}'],
    target: 'nsis',
    icon: 'public/brand/script-glow-mark-v2.png',
    ...(azure ? { azureSignOptions: { endpoint: process.env.AZURE_SIGNING_ENDPOINT, codeSigningAccountName: azure, certificateProfileName: process.env.AZURE_CERT_PROFILE, publisherName: process.env.AZURE_PUBLISHER_NAME } } : {}),
  },
  nsis: { oneClick: true, perMachine: false },
  publish: { provider: 'github', owner: 'Mariano215', repo: 'script-glow', releaseType: 'draft' },
};
