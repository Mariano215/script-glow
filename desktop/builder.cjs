// electron-builder settings. Windows signing turns on only when its settings are present, so the
// same file makes unsigned test builds. Mac signing and notarization follow the CSC_* and APPLE_*
// environment variables, which electron-builder reads by itself.
const azure = process.env.AZURE_SIGNING_ACCOUNT;
module.exports = {
  appId: 'io.github.mariano215.scriptglow',
  productName: 'Script Glow',
  directories: { output: 'release' },
  files: ['desktop/**', 'server/**', 'dist/**', 'package.json'],
  // The worker imports its own sibling (pdf-text.js), so the whole folder unpacks together.
  // pdfjs-dist's legacy build needs @napi-rs/canvas (a native module) at runtime for its
  // DOMMatrix/Path2D polyfills outside a browser.
  asarUnpack: ['server/**', 'node_modules/pdfjs-dist/**', 'node_modules/@napi-rs/**'],
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
