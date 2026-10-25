import { readFileSync, fstatSync, constants, openSync, closeSync } from 'node:fs';

export function loadConfig(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let config;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid() || stat.size > 65536) throw new Error('Configuration must be a private regular file owned by this user');
    config = JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  for (const field of ['ownerId', 'mcpBearerToken', 'telegramBotToken']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) throw new Error(`Missing configuration field: ${field}`);
  }
  config.telegramMode ??= 'webhook';
  if (!['webhook', 'polling'].includes(config.telegramMode)) throw new Error('Invalid Telegram mode');
  if (config.telegramMode === 'polling' && (typeof config.expectedBotId !== 'string' || !/^[1-9][0-9]*$/.test(config.expectedBotId) || typeof config.expectedBotUsername !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(config.expectedBotUsername))) throw new Error('Polling requires expected Bot identity');
  if (!/^[!-~]{32,4096}$/.test(config.mcpBearerToken) || (config.telegramMode === 'webhook' && (typeof config.telegramWebhookSecret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(config.telegramWebhookSecret)))) throw new Error('Invalid authentication configuration');
  if (!Array.isArray(config.allowedChatIds) || !config.allowedChatIds.length || !config.allowedChatIds.every(id => typeof id === 'string' && /^[1-9][0-9]*$/.test(id))) throw new Error('Explicit private chat allowlist required');
  return config;
}
