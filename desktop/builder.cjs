// electron-builder settings. Windows signing turns on only when its settings are present, so the
// same file makes unsigned test builds. Mac signing and notarization follow the CSC_* and APPLE_*
// environment variables, which electron-builder reads by itself.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const azure = process.env.AZURE_SIGNING_ACCOUNT;

// node_modules/@napi-rs only ever holds the binding for the machine that ran `npm install`
// (here, darwin-arm64). A Mac build for the other Intel/Apple Silicon arch needs its own
// native binding, at the same @napi-rs/canvas version, unpacked alongside it.
// `npm install` (even with --no-save --os --cpu) reconciles the whole tree for that other
// platform and deletes the arm64 binding this machine needs; `npm pack` just downloads the
// one tarball and never touches node_modules or the lockfile, so that is used instead.
async function ensureCanvasBinding(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { Arch } = require('electron-builder');
  const archName = Arch[context.arch];
  const dest = path.join(ROOT, 'node_modules', '@napi-rs', `canvas-darwin-${archName}`);
  if (fs.existsSync(dest)) return;
  const pkgName = `@napi-rs/canvas-darwin-${archName}`;
  const version = require('@napi-rs/canvas/package.json').version;
  console.log(`fetching ${pkgName}@${version} for the ${archName} build`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-glow-canvas-'));
  try {
    const tarball = execFileSync('npm', ['pack', `${pkgName}@${version}`, '--pack-destination', tmpDir], { cwd: ROOT }).toString().trim().split('\n').pop();
    execFileSync('tar', ['xzf', path.join(tmpDir, tarball), '-C', tmpDir]);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(path.join(tmpDir, 'package'), dest, { recursive: true });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = {
  appId: 'io.github.mariano215.scriptglow',
  productName: 'Script Glow',
  directories: { output: 'release' },
  files: ['desktop/**', 'server/**', 'dist/**', 'package.json'],
  beforePack: ensureCanvasBinding,
  // pdfjs-dist's legacy build needs @napi-rs/canvas (a native module) at runtime for its
  // DOMMatrix/Path2D polyfills outside a browser. The worker's own files are named directly;
  // it needs no other sibling from server/.
  asarUnpack: ['server/pdf-worker.js', 'server/pdf-text.js', 'node_modules/pdfjs-dist/**', 'node_modules/@napi-rs/**'],
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }, { target: 'zip', arch: ['arm64', 'x64'] }],
    icon: 'public/brand/script-glow-mark-v2.png',
    category: 'public.app-category.entertainment',
    hardenedRuntime: true,
    entitlements: 'desktop/entitlements.mac.plist',
    entitlementsInherit: 'desktop/entitlements.mac.plist',
    extendInfo: {
      NSCameraUsageDescription: 'Script Glow uses the camera to record your self-tapes.',
      NSMicrophoneUsageDescription: 'Script Glow uses the microphone to record your self-tapes and your own voice.',
    },
  },
  win: {
    target: 'nsis',
    icon: 'public/brand/script-glow-mark-v2.png',
    ...(azure ? { azureSignOptions: { endpoint: process.env.AZURE_SIGNING_ENDPOINT, codeSigningAccountName: azure, certificateProfileName: process.env.AZURE_CERT_PROFILE, publisherName: process.env.AZURE_PUBLISHER_NAME } } : {}),
  },
  nsis: { oneClick: true, perMachine: false },
  publish: { provider: 'github', owner: 'Mariano215', repo: 'script-glow', releaseType: 'draft' },
};
