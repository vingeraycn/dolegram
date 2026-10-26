import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../docs/web/analytics.js', import.meta.url), 'utf8');
function setup({ saved, legacy, blockedStorage = false, hostname = 'vingeraycn.github.io', pathname = '/dolegram/', privacy = {} } = {}) {
  const preferences = new Map();
  if (saved !== undefined) preferences.set('dolegram.analytics-disabled.v1', saved);
  if (legacy !== undefined) preferences.set('dolegram.analytics-consent.v1', legacy);
  const scripts = [], cookies = [];
  let reloads = 0;
  const settings = { hidden: true, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  vm.runInNewContext(source, {
    navigator: privacy,
    location: { hostname, pathname, reload() { reloads++; } },
    localStorage: {
      getItem(key) { if (blockedStorage) throw Error('Denied'); return preferences.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw Error('Denied'); preferences.set(key, value); },
    },
    document: {
      querySelector: () => settings,
      createElement: () => ({ setAttribute(name, value) { this[name] = value; } }),
      head: { append(script) { scripts.push(script); } },
      get cookie() { return 'dolegram_ga=one; dolegram_ga_YPHXN0WKW5=two; dolegram_garden=keep; other=keep'; },
      set cookie(value) { cookies.push(value); },
    },
  });
  return { scripts, cookies, settings, preferences, click: () => settings.handlers.click(), reloads: () => reloads };
}

test('production defaults to one official cookieless module with a public token', () => {
  const app = setup();
  assert.equal(app.scripts.length, 1);
  assert.equal(app.scripts[0].src, 'https://static.cloudflareinsights.com/beacon.min.js');
  assert.equal(app.scripts[0].type, 'module');
  assert.match(JSON.parse(app.scripts[0]['data-cf-beacon']).token, /^[a-f0-9]{32}$/);
  assert.equal(app.settings.textContent, 'Disable analytics');
});
test('saved opt-out and legacy GA refusal prevent loading', () => {
  for (const options of [{ saved: 'true' }, { legacy: 'denied' }]) {
    const app = setup(options);
    assert.equal(app.scripts.length, 0);
    assert.equal(app.settings.textContent, 'Enable analytics');
  }
  assert.equal(setup({ saved: 'false', legacy: 'denied' }).scripts.length, 1);
});
test('privacy signals prevent loading and cannot be overridden by the footer', () => {
  for (const privacy of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
    const app = setup({ privacy });
    assert.equal(app.scripts.length, 0);
    assert.equal(app.settings.disabled, true);
    assert.equal(app.settings.textContent, 'Analytics off');
  }
});
test('unavailable preference storage fails closed', () => {
  const app = setup({ blockedStorage: true });
  assert.equal(app.scripts.length, 0);
  assert.equal(app.settings.disabled, true);
});
test('only the exact production host and path load analytics', () => {
  for (const options of [{ hostname: 'localhost' }, { hostname: 'fork.github.io' }, { pathname: '/another-project/' }]) {
    const app = setup(options);
    assert.equal(app.scripts.length, 0);
    assert.equal(app.cookies.length, 0);
    assert.equal(app.settings.hidden, true);
  }
});
test('opt-out persists and reloads to unload vendor listeners; opt-in reverses it', () => {
  const app = setup(); app.click();
  assert.equal(app.preferences.get('dolegram.analytics-disabled.v1'), 'true');
  assert.equal(app.reloads(), 1);
  const optedOut = setup({ saved: 'true' }); optedOut.click();
  assert.equal(optedOut.preferences.get('dolegram.analytics-disabled.v1'), 'false');
  assert.equal(optedOut.reloads(), 1);
});
test('migration expires only former scoped GA cookies', () => {
  const app = setup();
  assert.equal(app.cookies.length, 2);
  assert.ok(app.cookies.every(value => value.includes('Path=/dolegram; Domain=vingeraycn.github.io;')));
  assert.ok(app.cookies.every(value => !value.includes('garden') && !value.includes('other')));
});
test('a blocked vendor script does not prevent opting out', () => {
  const app = setup(); // No vendor script executes in this harness.
  assert.doesNotThrow(() => app.click());
  assert.equal(app.reloads(), 1);
});
