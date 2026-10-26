import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../docs/web/analytics.js', import.meta.url), 'utf8').replace('export function track', 'function track');
function setup({ saved = null, blockedStorage = false, hostname = 'vingeraycn.github.io' } = {}) {
  const nodes = new Map();
  const scripts = [];
  const writes = [];
  let preference = saved;
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: true, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, focus() {} });
    return nodes.get(selector);
  };
  const document = {
    querySelector: node,
    createElement: () => ({}),
    head: { append: (script) => scripts.push(script) },
    referrer: 'https://example.com/private/path?email=private@example.com',
    addEventListener() {},
    get cookie() { return 'dolegram_ga=one; dolegram_ga_YPHXN0WKW5=two; other=keep'; },
    set cookie(value) { writes.push(value); },
  };
  const window = {};
  const context = vm.createContext({
    window, document, URL, location: { hostname, pathname: '/dolegram/' },
    localStorage: {
      getItem() { if (blockedStorage) throw Error('Denied'); return preference; },
      setItem(_key, value) { if (blockedStorage) throw Error('Denied'); preference = value; },
    },
    IntersectionObserver: class { observe() {} disconnect() {} },
  });
  vm.runInContext(source, context);
  return { window, scripts, writes, node, track: (name) => context.track(name),
    choose: (accept) => node(accept ? '#analytics-accept' : '#analytics-decline').handlers.click(),
    commands: () => Array.from(window.dataLayer || [], (args) => Array.from(args)),
  };
}

test('analytics sends nothing before consent or after stored refusal', () => {
  for (const saved of [null, 'denied']) {
    const app = setup({ saved });
    app.track('install_start');
    assert.equal(app.scripts.length, 0);
    assert.equal(app.commands().length, 0);
  }
});
test('acceptance loads one tag, excludes private URL data and disables advertising', () => {
  const app = setup(); app.choose(true); app.choose(true);
  assert.equal(app.scripts.length, 1);
  const configs = app.commands().filter(([name]) => name === 'config');
  assert.equal(configs.length, 1);
  const config = configs[0][2];
  assert.equal(config.page_location, 'https://vingeraycn.github.io/dolegram/');
  assert.equal(config.page_referrer, 'https://example.com');
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.cookie_path, '/dolegram');
  app.track('install_prompt_copy'); app.track('private_message');
  assert.deepEqual(app.commands().filter(([name]) => name === 'event').map(([, name]) => name), ['install_prompt_copy']);
});
test('withdrawal blocks events and removes only scoped website cookies', () => {
  const app = setup({ saved: 'granted' }); app.choose(false);
  const count = app.commands().length;
  app.track('install_start');
  assert.equal(app.commands().length, count);
  assert.equal(app.window['ga-disable-G-YPHXN0WKW5'], true);
  assert.equal(app.writes.length, 2);
  assert.ok(app.writes.every((value) => value.startsWith('dolegram_ga') && value.includes('Path=/dolegram;')));
});
test('storage denial preserves session-only explicit consent', () => {
  const app = setup({ blockedStorage: true });
  assert.equal(app.scripts.length, 0);
  app.choose(true); assert.equal(app.scripts.length, 1);
  app.choose(false); assert.equal(app.window['ga-disable-G-YPHXN0WKW5'], true);
});
test('local previews and forks never send to the production property', () => {
  const app = setup({ hostname: 'localhost', saved: 'granted' });
  app.choose(true); app.track('install_start');
  assert.equal(app.scripts.length, 0);
  assert.equal(app.commands().length, 0);
});
test('blocked Google script does not break interactions or withdrawal', () => {
  const app = setup(); app.choose(true);
  app.track('install_start'); app.choose(false);
  assert.equal(app.window['ga-disable-G-YPHXN0WKW5'], true);
});
