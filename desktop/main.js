// Desktop shell: runs the same server inside Electron and shows it in one window.
import { app, BrowserWindow, session, shell } from 'electron';
import updater from 'electron-updater';

// Top-level await in this ESM entry point hangs before Electron's 'ready' event fires
// (the main process needs its native event loop pumped during module evaluation, which
// a top-level await blocks). An async function sidesteps that.
async function main() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  // The server reads this at import time, so it is set before the server is imported.
  process.env.SCRIPT_GLOW_HOME ??= app.getPath('userData');
  let window;
  // A second launch shows the open window, so two copies never write the same projects.
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  await app.whenReady();
  const { createApp } = await import('../server/app.js');
  const { CONNECTIONS_FILE, loadConnections } = await import('../server/connections.js');
  const connections = await loadConnections(CONNECTIONS_FILE);
  // Port 0: the system picks a free port, so another program on 3001 is never a problem.
  const server = createApp({ connections, connectionsFile: CONNECTIONS_FILE, firstRunScreen: true }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Camera and microphone for self-tape and Record my voice, for this app's page only.
  session.defaultSession.setPermissionRequestHandler((contents, permission, done, details) => done(permission === 'media' && new URL(details.requestingUrl).origin === origin));
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => permission === 'media' && requestingOrigin === origin);
  window = new BrowserWindow({ width: 1440, height: 960, title: 'Script Glow', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  // Voice credits and help links open in the default browser. Nothing else opens a window.
  window.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  await window.loadURL(origin);
  // Updates come from the GitHub Release. A failed check must never stop the app.
  if (app.isPackaged) updater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

main();
