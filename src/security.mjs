import { timingSafeEqual } from 'node:crypto';
import { lookup, Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import ipaddr from 'ipaddr.js';

export function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function publicAddress(address) {
  try {
    const ip = ipaddr.process(address);
    return ip.range() === 'unicast';
  } catch { return false; }
}

// Only callback lookups use this optional resolver; never alter global DNS.
export function callbackResolver(serverList) {
  if (!serverList) return lookup;
  const servers = serverList.split(',').map(value => value.trim());
  if (!servers.length || servers.some(value => !isIP(value))) throw new Error('Invalid callback DNS servers');
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  resolver.setServers(servers);
  return async host => {
    const family = isIP(host);
    if (family) return [{ address: host, family }];
    const answers = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
    const addresses = [];
    for (const [index, result] of answers.entries()) {
      if (result.status === 'fulfilled') {
        addresses.push(...result.value.map(address => ({ address, family: index === 0 ? 4 : 6 })));
      } else if (!['ENODATA', 'ENOTFOUND'].includes(result.reason?.code)) {
        throw new Error('Callback DNS lookup failed');
      }
    }
    return addresses;
  };
}

// Pin each request to a checked DNS answer, while keeping TLS hostname checks.
/** @param {(host: string, options: import('node:dns').LookupAllOptions) => Promise<import('node:dns').LookupAddress[]>} [resolver] */
export async function callbackPost(destination, body, headers, resolver = lookup) {
  const url = new URL(destination);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
    throw new Error('Unsafe callback URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const signal = AbortSignal.timeout(10000);
  /** @type {Promise<never>} */
  const timeout = new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Callback timeout')), { once: true });
  });
  const addresses = await Promise.race([resolver(host, { all: true, verbatim: true }), timeout]);
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
    throw new Error('Unsafe callback address');
  }
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST', signal, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      lookup: (_hostname, options, done) => {
        if (options.all) done(null, [target]);
        else done(null, target.address, target.family);
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
        if (Buffer.byteLength(text) > 16384) response.destroy(new Error('Callback response too large'));
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: text }));
    });
    request.setTimeout(10000, () => request.destroy(new Error('Callback timeout')));
    request.on('error', reject);
    request.end(body);
  });
}
