import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { closeWebServer, startWebServer } from '../src/web-server.js';

test('health endpoint reflects Discord readiness', async () => {
  let ready = false;
  const server = startWebServer(0, () => ({ discordReady: ready, recording: false }));
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;

  try {
    const unavailable = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(unavailable.status, 503);

    ready = true;
    const healthy = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { healthy: true, discordReady: true, recording: false });
  } finally {
    await closeWebServer(server);
  }
});
