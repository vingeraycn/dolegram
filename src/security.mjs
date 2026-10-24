import { timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
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

// Pin each request to a checked DNS answer, while keeping TLS hostname checks.
export async function callbackPost(destination, body, headers, resolver = lookup) {
  const url = new URL(destination);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
    throw new Error('Unsafe callback URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await resolver(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
    throw new Error('Unsafe callback address');
  }
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST', signal: AbortSignal.timeout(10000), headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
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
