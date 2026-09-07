/**
 * Behaviour tests for the CDN tracking script.
 *
 * This file exists because `deploy-analytics.yml` builds `src/analytics.js` and
 * uploads it straight to R2 on every merge to main — it lands on customers'
 * pages with nothing standing between the edit and the CDN. The cases below are
 * the ones that cannot be caught by looking at the file: each one FAILED on the
 * tracker as it shipped before #1884's follow-up.
 *
 * No framework and no dependencies on purpose — the deploy job installs only
 * terser, so this has to run on bare node.
 *
 *   node __tests__/analytics.behaviour.mjs [path-to-src]
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(here, '..', 'src', 'analytics.js');
const SRC = fs.readFileSync(target, 'utf8');

function makeEnv({ storageThrows = false, beaconResult = true, hasBeacon = true,
                   currentScriptNull = false, fetchStatus = 200 } = {}) {
  const sent = [], warns = [], errors = [], fetches = [];
  const mkStore = () => {
    const m = new Map();
    return {
      getItem: k => { if (storageThrows) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
      setItem: (k, v) => { if (storageThrows) throw new Error('SecurityError'); m.set(k, String(v)); },
      removeItem: k => { if (storageThrows) throw new Error('SecurityError'); m.delete(k); },
    };
  };
  const tag = { getAttribute: n => (n === 'data-website-id' ? 'web_TEST' : null) };
  const doc = {
    currentScript: currentScriptNull ? null : tag,
    querySelector: sel => (sel.includes('data-website-id') ? tag : null),
    title: 't', referrer: '', body: { textContent: '' },
    addEventListener() {}, querySelectorAll: () => [],
    documentElement: { scrollHeight: 1000 }, visibilityState: 'visible',
  };
  const sandbox = {
    document: doc,
    navigator: {
      ...(hasBeacon ? { sendBeacon: (ep, b) => { if (beaconResult) sent.push(ep); return beaconResult; } } : {}),
      language: 'en-AU', languages: ['en-AU'], userAgent: 'test',
    },
    window: {
      location: { pathname: '/p', search: '', href: 'https://x/p' },
      addEventListener() {}, innerHeight: 800, scrollY: 0,
    },
    history: { pushState() {}, replaceState() {}, back() {} },
    localStorage: mkStore(), sessionStorage: mkStore(),
    Blob: class { constructor(p) { this.parts = p; } },
    fetch: (ep, opts) => { fetches.push(ep); return Promise.resolve({ ok: fetchStatus < 400, status: fetchStatus }); },
    console: { log() {}, warn: (...a) => warns.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
    URLSearchParams, Intl, Date, Math, JSON, parseInt, Object, Array, String, Promise, Error,
  };
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.sessionStorage = sandbox.sessionStorage;
  sandbox.globalThis = sandbox;
  return { sandbox, sent, warns, errors, fetches };
}

function run(name, opts, check) {
  const env = makeEnv(opts);
  let threw = null;
  try { vm.createContext(env.sandbox); vm.runInContext(SRC, env.sandbox); }
  catch (e) { threw = e; }
  return Promise.resolve().then(() => {
    const r = check({ ...env, threw, api: env.sandbox.window.jytAnalytics });
    console.log((r === true ? 'PASS  ' : 'FAIL  ') + name + (r === true ? '' : '  -> ' + r));
    return r === true;
  });
}

const results = [];
results.push(run('storage throws -> tracker still sends pageview', { storageThrows: true },
  e => e.threw ? 'threw: ' + e.threw.message : (e.sent.length > 0 ? true : 'nothing sent')));

results.push(run('storage throws -> one stable visitor id per page', { storageThrows: true },
  e => { if (!e.api) return 'no api'; const a = e.api.getVisitorId(), b = e.api.getVisitorId();
         return a === b ? true : 'ids differ: ' + a + ' vs ' + b; }));

results.push(run('storage throws -> one stable session id per page', { storageThrows: true },
  e => { if (!e.api) return 'no api'; const a = e.api.getSessionId(), b = e.api.getSessionId();
         return a === b ? true : 'ids differ: ' + a + ' vs ' + b; }));

results.push(run('currentScript null -> falls back to querySelector, still sends', { currentScriptNull: true },
  e => e.threw ? 'threw: ' + e.threw.message : (e.sent.length > 0 ? true : 'nothing sent')));

results.push(run('sendBeacon refuses (false) -> retried via fetch', { beaconResult: false },
  e => e.fetches.length > 0 ? true : 'no fetch fallback; event dropped'));

results.push(run('sendBeacon ok -> fetch NOT also called (no double-send)', { beaconResult: true },
  e => e.fetches.length === 0 ? true : 'double-sent via fetch'));

results.push(run('400 on fetch path -> warns', { hasBeacon: false, fetchStatus: 400 },
  e => e.warns.some(w => w.includes('rejected') && w.includes('400')) ? true : 'no warn; warns=' + JSON.stringify(e.warns)));

results.push(run('200 on fetch path -> no warn', { hasBeacon: false, fetchStatus: 200 },
  e => e.warns.some(w => w.includes('rejected')) ? 'warned on success' : true));

Promise.all(results).then(rs => {
  const bad = rs.filter(r => !r).length;
  console.log(
    '\n' + (rs.length - bad) + '/' + rs.length + ' passed  (' + target + ')'
  );
  process.exit(bad ? 1 : 0);
});
