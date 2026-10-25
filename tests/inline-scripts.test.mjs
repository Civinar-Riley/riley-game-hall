import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const games = new URL('../public/games/', import.meta.url);
const files = (await readdir(games)).filter(name => name.endsWith('.html'));

for (const file of files) {
  test(`${file} inline scripts parse without a bundler`, async () => {
    const html = await readFile(new URL(file, games), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length > 0);
    for (const [index, script] of scripts.entries()) {
      assert.doesNotThrow(() => new vm.Script(script[1], { filename: `${file}:script-${index + 1}` }));
    }
  });
}
