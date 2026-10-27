#!/usr/bin/env node
// A loopback STAND-IN for PingOne, for trying live mode (or proving it in a browser) without touching a real environment.
//   node scripts/live-stub.mjs [environment-uuid]
// Prints the URL and the stub's own worker credentials (invented, they open nothing). Then run the app against it:
//   P1TPX_LIVE_STUB=<url> DEMO_KIT_CONFIG_DIR=<a scratch dir> MODE=live P1TPX_ALLOW_LIVE=1 npm start
// ALWAYS set DEMO_KIT_CONFIG_DIR to a scratch directory when using the stub: the app saves the live settings to <dir>/pingone.json,
// and without it that is your real shared PingOne settings file.
import { startStub } from '../server/src/live/stub.js';

const envId = process.argv[2] || 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const stub = await startStub({ envId });
console.log(JSON.stringify({ stub: stub.url, environmentId: envId, clientId: stub.workerId, clientSecret: stub.workerSecret, note: 'stub only: invented credentials' }));
process.on('SIGINT', () => stub.close().then(() => process.exit(0)));
