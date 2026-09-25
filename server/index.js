import { createApp } from './app.js';
import { CONNECTIONS_FILE, loadConnections } from './connections.js';
import { moveOldSecrets, SECRETS_FILE } from './secrets.js';
const stop = message => { console.error(`Script Glow could not start: ${message}`); process.exit(1); };
// PORT changes the port only. A second copy still shares data/ and .cache/ with the first.
// PORT=0 asks the system for a free port.
const port = (process.env.PORT ?? '') === '' ? 3001 : Number(process.env.PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) stop(`PORT must be a whole number from 0 to 65535, not "${process.env.PORT}".`);
// Settings are saved back to the file they were loaded from.
const connectionsFile = process.env.SCRIPT_GLOW_CONFIG || CONNECTIONS_FILE;
let connections;
try {
  connections = await loadConnections(connectionsFile);
  if (await moveOldSecrets()) console.log(`API keys moved to ${SECRETS_FILE}`);
} catch (error) { stop(error.message); }
// HOST exists for Docker, where 0.0.0.0 lets the published port reach the app. Requests must still name a loopback host.
const host = process.env.HOST || '127.0.0.1';
// Express 5 passes a listen failure (such as a port in use) to this callback instead of throwing.
const server = createApp({ connections, connectionsFile, firstRunScreen: true }).listen(port, host, error => {
  if (error) { console.error(`Script Glow could not start on port ${port}: ${error.message}`); process.exit(1); }
  console.log(`Script Glow: http://127.0.0.1:${server.address().port} · ${connections.name}`);
});
