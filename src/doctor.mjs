import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { loadConfig } from './config.mjs';

function loopback(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid loopback address');
  return url.origin;
}

export function readHealthAddress(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o022) || stat.size > 1024) throw new Error('Invalid health file');
    return loopback(readFileSync(fd, 'utf8').trim());
  } finally { closeSync(fd); }
}

// Never follow a redirect with an authorization header or echo a remote body.
async function requestJson(url, options, request) {
  const response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) { await response.body?.cancel(); return { status: response.status, data: null }; }
  const chunks = [];
  let size = 0;
  if (response.body) for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 262144) throw new Error('Response exceeds limit');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

export function assessDiagnostics(d, now = Date.now()) {
  const checks = [];
  const add = (id, level, summary, action = null) => checks.push({ id, level, summary, action });
  const count = n => Number.isSafeInteger(n) && n >= 0;
  const timestamp = n => n === null || (Number.isSafeInteger(n) && n >= 0);
  const stages = ['awaitingSubscription', 'callbackPending', 'callbackFailed', 'waitingForDot', 'processing', 'partial', 'writing', 'uncertain', 'completed'];
  if (d?.version !== 1 || !d.intake || !d.subscription || !d.stages ||
      !stages.every(key => count(d.stages[key])) ||
      !['active', 'coveredChats', 'requiredChats'].every(key => count(d.subscription[key])) ||
      !timestamp(d.subscription.nextExpiryAt) || !timestamp(d.oldestPendingAt) || !timestamp(d.lastCompletedAt)) {
    add('diagnostics', 'warn', 'Detailed diagnostics are unavailable.', 'Upgrade the backend using the documented backup and rollback procedure.');
    return checks;
  }
  const intake = d.intake;
  if (intake.state === 'polling' && Number.isFinite(intake.lastSuccessAt) && now - intake.lastSuccessAt < 90000) {
    add('intake', 'ok', 'Telegram polling has completed a recent successful cycle.');
  } else if (intake.state === 'stopped') {
    add('intake', 'fail', 'Telegram polling has stopped.', intake.reason === 'conflict'
      ? 'Identify and stop the competing consumer before restarting dotg; do not delete Bot configuration.'
      : 'Inspect Bot identity, webhook, credentials and storage before restarting the backend.');
  } else if (intake.state === 'retrying') {
    add('intake', 'warn', 'Telegram polling is backing off.', 'Allow the current retry to finish; inspect network access or Telegram rate limits if it persists.');
  } else if (intake.state === 'disabled') {
    add('intake', 'warn', 'Telegram polling is disabled.', 'Complete real host discovery and subscription, then hand over the sole consumer before enabling polling.');
  } else {
    add('intake', 'warn', 'Recent successful polling is not established.', 'Check the configured intake mode and backend process; a listening port alone does not prove intake.');
  }
  const sub = d.subscription;
  if (!sub.active || sub.coveredChats < sub.requiredChats) add('subscription', 'fail', 'Some approved chats have no active event subscription.', 'Inspect the existing private connection and host task. Refresh the intended subscription; do not create duplicates.');
  else if (sub.nextExpiryAt === null || sub.nextExpiryAt <= now + 300000) add('subscription', 'warn', 'Event subscription renewal is due soon.', 'Verify host renewal. Tunnel key lifetime does not extend event subscriptions.');
  else add('subscription', 'ok', 'All approved chats have an active signed subscription.');
  const s = d.stages;
  if (s.awaitingSubscription || s.callbackFailed) add('delivery', 'fail', `${s.awaitingSubscription + s.callbackFailed} message(s) need event-delivery recovery.`, 'Restore the intended subscription and inspect bounded pending messages from the existing Dot task; do not resend Telegram updates.');
  else if (s.callbackPending) add('delivery', 'warn', `${s.callbackPending} message(s) await callback acceptance.`, 'Inspect callback retry progress and network/DNS validation if this persists.');
  else add('delivery', 'ok', 'No outstanding callback delivery failures were found.');
  if (s.uncertain) add('replies', 'fail', `${s.uncertain} reply outcome(s) are uncertain.`, 'Inspect the actual Telegram conversation and reconcile stored intent before retrying.');
  else if (s.waitingForDot + s.processing + s.partial + s.writing) {
    add('replies', 'warn', `Waiting for Dot: ${s.waitingForDot}; processing: ${s.processing}; partial: ${s.partial}; writing: ${s.writing}.`, 'Check the existing Dot task if the wait persists. Callback acceptance is not a completed reply.');
  } else add('replies', 'ok', 'No in-progress or uncertain replies were found.');
  add('acceptance', s.completed ? 'ok' : 'warn', s.completed
    ? `${s.completed} completed reply record(s) exist; this is historical evidence.`
    : 'No completed reply is recorded.', 'A fresh Telegram send/read/reply/edit test is still required for installation or recovery acceptance.');
  return checks;
}

export async function runDoctor({ configPath, healthFile = null, backend = 'http://127.0.0.1:8787', request = fetch }) {
  const checks = [];
  const add = (id, level, summary, action = null) => checks.push({ id, level, summary, action });
  let config;
  try { config = loadConfig(configPath); add('configuration', 'ok', 'Private configuration is valid and owned by this user.'); }
  catch { add('configuration', 'fail', 'Private configuration is missing, unsafe or invalid.', 'Inspect the intended configuration file and its permissions; never paste credentials into chat.'); }
  if (config) {
    try {
      const origin = loopback(backend);
      const rpc = async (method, params = {}) => {
        const result = await requestJson(`${origin}/mcp`, { method: 'POST', headers: {
          'Content-Type': 'application/json', Authorization: `Bearer ${config.mcpBearerToken}`,
        }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, request);
        if (result.status === 401) throw new Error('unauthorized');
        if (!result.data?.result || result.data.error || result.data.result.isError) throw new Error('invalid');
        return result.data.result;
      };
      const discover = await rpc('server/discover');
      const listed = await rpc('tools/list');
      if (!discover.capabilities?.events || !Array.isArray(listed.tools) ||
          !['get_bridge_status', 'read_telegram_message', 'reply_telegram_message', 'update_telegram_message'].every(name => listed.tools.some(tool => tool.name === name))) throw new Error('invalid');
      const result = await rpc('tools/call', { name: 'get_bridge_status', arguments: {} });
      const status = JSON.parse(result.content?.find(item => item.type === 'text')?.text);
      add('backend', 'ok', 'Authenticated local discovery and status call succeeded.');
      checks.push(...assessDiagnostics(status.diagnostics));
    } catch (error) {
      add('backend', 'fail', error.message === 'unauthorized' ? 'Backend rejected local authentication.' : 'Backend discovery or status could not be verified.',
        'Inspect the intended backend, port and configuration; preserve the database lock and do not start a second consumer.');
    }
  }
  if (healthFile) {
    try {
      const origin = readHealthAddress(healthFile);
      // Health endpoints may return plain text; status alone is their contract.
      const responses = await Promise.all(['/healthz', '/readyz'].map(async path => {
        const response = await request(`${origin}${path}`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
        await response.body?.cancel();
        return response.status;
      }));
      if (responses.every(status => status === 200)) add('tunnel', 'ok', 'The configured Tunnel client reports healthy and ready.');
      else add('tunnel', 'fail', 'The configured Tunnel client is not healthy and ready.', 'Inspect its dedicated launcher, exact Keychain access and runtime key status.');
    } catch { add('tunnel', 'fail', 'Tunnel health could not be verified.', 'Inspect the dedicated client and its health address file; do not create another Tunnel or key.'); }
  } else add('tunnel', 'warn', 'Tunnel health was not checked.', 'Supply --tunnel-health-file with the dedicated client health URL file.');
  const level = checks.some(check => check.level === 'fail') ? 'fail' : checks.some(check => check.level === 'warn') ? 'warn' : 'ok';
  return { version: 1, checkedAt: new Date().toISOString(), level, checks,
    scope: 'Read-only local diagnostics. No Telegram polling, message writes, Keychain access or repairs. This does not verify current host tool discovery or end-to-end delivery.' };
}
