import { createApp } from './app.js';
import { loadConnections } from './connections.js';
const port = 3001;
const connections = await loadConnections();
createApp({ connections }).listen(port, '127.0.0.1', () => console.log(`Script Glow: http://127.0.0.1:${port} · ${connections.name}`));
