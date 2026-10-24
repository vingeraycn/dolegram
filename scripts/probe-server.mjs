import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Reachability checks only: no credentials, database, proxying or Bot calls.
export function createIngressProbe() {
  const server = createServer((request, response) => {
    const protectedRoute = request.method === 'POST' && ['/mcp', '/telegram/webhook'].includes(request.url);
    response.writeHead(protectedRoute ? 401 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: protectedRoute ? 'Probe only; live bridge not configured' : 'Not found' }));
    request.resume();
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = createIngressProbe();
  server.on('error', () => { console.error('Probe could not bind loopback port 8787'); process.exitCode = 1; });
  server.listen(8787, '127.0.0.1', () => console.log('Deny-all ingress probe on 127.0.0.1:8787; no public tunnel started.'));
  const stop = () => server.close();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
