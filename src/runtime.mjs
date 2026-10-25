import { closeSync, fstatSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { Bridge } from './bridge.mjs';
import { Store } from './store.mjs';
import { telegramClient } from './telegram.mjs';
import { TelegramActivity } from './activity.mjs';
import { TelegramPoller } from './polling.mjs';
import { callbackPost, callbackResolver } from './security.mjs';

// run-backend.py holds the lease across exec. Never unlink a lease: another
// process must contend on the same inode, including after a crash or reboot.
function inheritedLease(database) {
  const value = process.env.DOTG_LOCK_FD;
  if (!value || !/^[0-9]+$/.test(value)) throw new Error('Missing runtime lease');
  const fd = Number(value);
  if (!Number.isSafeInteger(fd) || fd < 3) throw new Error('Invalid runtime lease');
  const held = fstatSync(fd);
  const path = lstatSync(`${database}.lease`);
  if (!held.isFile() || !path.isFile() || held.dev !== path.dev || held.ino !== path.ino ||
      held.uid !== process.getuid() || (held.mode & 0o777) !== 0o600 || held.nlink !== 1) throw new Error('Invalid runtime lease');
  return fd;
}

export async function runStandalone({ createBridgeServer, closeBridgeServer }) {
  let fd;
  let store;
  let server;
  let stopping;
  let polling = Promise.resolve();
  const controller = new AbortController();
  const stop = () => {
    stopping ??= (async () => {
      controller.abort();
      try {
        await Promise.all([polling, server ? closeBridgeServer(server) : Promise.resolve()]);
        store?.close();
        if (fd !== undefined) closeSync(fd);
      } catch {
        // Keep the OS lease until process exit if draining fails.
        console.error('dotg shutdown incomplete; inspect the backend before restarting');
        process.exitCode = 1;
      }
    })();
    return stopping;
  };
  try {
    const database = resolve(process.env.DOTG_DATABASE ?? 'runtime/dotg.sqlite');
    fd = inheritedLease(database);
    const config = loadConfig(process.env.DOTG_CONFIG ?? 'config.local.json');
    const resolveCallback = callbackResolver(process.env.DOTG_CALLBACK_DNS_SERVERS);
    if (process.env.DOTG_ENABLE_POLLING === '1' && config.telegramMode !== 'polling') throw new Error('Polling mode required');
    const port = Number(process.env.DOTG_PORT ?? 8787);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
    store = new Store(database);
    const state = store.read();
    if (state.recovery?.required) throw new Error('Restored state requires offline review');
    if (state.recovery && config.telegramMode !== 'polling') throw new Error('Staged recovery requires the polling route');
    if (state.recovery && process.env.DOTG_ENABLE_POLLING === '1') {
      const fresh = Object.values(state.subscriptions).filter(sub => sub.owner === config.ownerId &&
        sub.verifiedAt > state.recovery.restoredAt && sub.expiresAt > Date.now());
      if (!config.allowedChatIds.every(chat => fresh.some(sub => sub.chatId === chat))) {
        throw new Error('Restored state requires fresh host subscriptions before polling');
      }
    }
    const telegram = telegramClient(config.telegramBotToken);
    const activity = new TelegramActivity({ store, config, telegram });
    const bridge = new Bridge({ store, config, telegram, activity,
      post: (url, body, headers) => callbackPost(url, body, headers, resolveCallback) });
    const poller = process.env.DOTG_ENABLE_POLLING === '1'
      ? new TelegramPoller({ bridge, store, telegram, botId: config.expectedBotId, username: config.expectedBotUsername }) : null;
    bridge.intakeStatus = () => poller?.status() ?? { state: config.telegramMode === 'polling' ? 'disabled' : 'webhook' };
    server = createBridgeServer(bridge);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(undefined); });
    });
    server.on('error', () => { console.error('dotg listener failed'); process.exitCode = 1; void stop(); });
    console.log(`dotg listening on loopback port ${port}`);
    if (poller) polling = poller.run(controller.signal).catch(() => {
      // A conflict or invalid identity must not enter an automatic restart loop.
      console.error('dotg polling stopped; operator inspection required');
    });
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch {
    console.error('dotg startup failed; check private configuration, runtime lease, recovery review and loopback port');
    process.exitCode = 1;
    await stop();
  }
}
