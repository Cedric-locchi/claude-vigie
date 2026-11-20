// node --test daemon/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { csp, hostOk, staticFile } from './guard.mjs';

test('hôte : seulement 127.0.0.1 ou localhost sur notre port', () => {
  for (const h of ['127.0.0.1:4317', 'localhost:4317', 'LOCALHOST:4317']) assert.equal(hostOk(h, 4317), true, h);
  for (const h of ['evil.com:4317', '127.0.0.1:80', '127.0.0.1', 'localhost.:4317', '[::1]:4317', undefined, '']) assert.equal(hostOk(h, 4317), false, String(h));
});

test('fichier statique : décodé, reste sous le dossier de l’UI', () => {
  const ui = path.join(path.sep, 'app', 'ui');
  assert.equal(staticFile(ui, '/%C0'), null);
  assert.equal(staticFile(ui, '/a%00.js'), null);
  assert.equal(staticFile(ui, '/main.js'), path.join(ui, 'main.js'));
  assert.equal(staticFile(ui, '/a%20b.js'), path.join(ui, 'a b.js'));
  for (const p of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd']) {
    const f = staticFile(ui, p);
    assert.ok(f === ui || f.startsWith(ui + path.sep), `${p} → ${f}`);
  }
});

test('csp : décision 044 à l’identique, port injecté dans connect-src ; rien vers l’extérieur', () => {
  assert.equal(csp(4317), "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4317 ws://localhost:4317; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  assert.match(csp(5000), /connect-src 'self' ws:\/\/127\.0\.0\.1:5000 ws:\/\/localhost:5000;/);
  assert.doesNotMatch(csp(4317), /https?:|unsafe-eval|\*/);
});
