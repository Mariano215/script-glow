import { createApp } from './app.js';
import { CONNECTIONS_FILE, loadConnections } from './connections.js';
import { moveOldSecrets, SECRETS_FILE } from './secrets.js';
// PORT changes the port only. A second copy still shares data/ and .cache/ with the first.
const port = Number(process.env.PORT) || 3001;
// Settings are saved back to the file they were loaded from.
const connectionsFile = process.env.SCRIPT_GLOW_CONFIG || CONNECTIONS_FILE;
const connections = await loadConnections(connectionsFile);
if (await moveOldSecrets()) console.log(`API keys moved to ${SECRETS_FILE}`);
// Express 5 passes a listen failure (such as a port in use) to this callback instead of throwing.
createApp({ connections, connectionsFile, firstRunScreen: true }).listen(port, '127.0.0.1', error => {
  if (error) { console.error(`Script Glow could not start on port ${port}: ${error.message}`); process.exit(1); }
  console.log(`Script Glow: http://127.0.0.1:${port} · ${connections.name}`);
});
