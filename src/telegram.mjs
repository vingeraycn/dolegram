export class TelegramFailure extends Error {
  constructor(code, retryAfter = 0) {
    super('Telegram request failed');
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function telegramClient(token, request = fetch) {
  return async (method, params, signal = undefined) => {
    let response;
    let data;
    try {
      response = await request(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(method === 'getUpdates' ? 35000 : 10000)]) : AbortSignal.timeout(method === 'getUpdates' ? 35000 : 10000), redirect: 'error',
      });
      data = await response.json();
    } catch { throw new TelegramFailure('uncertain'); }
    if (!response.ok || !data.ok) {
      if (data.error_code === 409) throw new TelegramFailure('conflict');
      if (data.error_code === 429) throw new TelegramFailure('rate_limit', Number(data.parameters?.retry_after) || 1);
      if (data.error_code === 400 && data.description?.includes('message is not modified')) return null;
      if (response.status >= 500) throw new TelegramFailure('uncertain');
      throw new TelegramFailure('rejected');
    }
    return data.result;
  };
}
