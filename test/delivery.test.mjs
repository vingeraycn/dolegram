import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryWorker } from '../src/delivery.mjs';

test('delivery kicks coalesce and closing prevents another pass', async () => {
  let release;
  let calls = 0;
  let stop;
  const worker = new DeliveryWorker({ deliver: async ({ shouldStop }) => {
    calls += 1; stop = shouldStop;
    await new Promise(resolve => { release = resolve; });
  } });
  const job = worker.kick();
  await Promise.resolve();
  for (let n = 0; n < 20; n++) worker.kick();
  assert.equal(calls, 1);
  let closed = false;
  const closing = worker.close().then(() => { closed = true; });
  assert.equal(stop(), true);
  await Promise.resolve();
  assert.equal(closed, false);
  release();
  await Promise.all([job, closing]);
  await worker.kick();
  assert.equal(calls, 1);
});
