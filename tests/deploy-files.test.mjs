// The Pages workflow publishes only the files listed in its "cp" line. A new module that the app imports but that is missing
// from that list gives a 404 on the live site (the whole app fails to load). This test fails before that can ship.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = f => readFileSync(new URL(f, root), "utf8");
let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };

const cpLine = read(".github/workflows/pages.yml").split("\n").find(l => /^\s*cp index\.html /.test(l));
assert.ok(cpLine, 'pages.yml has no "cp index.html ..." line');
const published = new Set(cpLine.trim().split(/\s+/).slice(1, -1)); // between "cp" and the "_site/" target

// every local file the page needs: start at index.html's module script and follow static and dynamic imports
function needed() {
  const seen = new Set(), queue = [];
  for (const m of read("index.html").matchAll(/<script[^>]*\ssrc="([^"#?]+)"/g)) queue.push(m[1]);
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f) || /^https?:/.test(f)) continue;
    seen.add(f);
    if (!f.endsWith(".js") || !existsSync(new URL(f, root))) continue;
    for (const m of read(f).matchAll(/(?:from\s+|import\s*\(\s*)["']\.\/([^"']+\.js)["']/g)) queue.push(m[1]);
  }
  return seen;
}

ok("every module the app imports is published by the workflow", () => {
  const missing = [...needed()].filter(f => !published.has(f));
  assert.deepEqual(missing, [], `missing from the cp line in pages.yml: ${missing.join(", ")}`);
});
ok("every file the service worker precaches is published (a 404 breaks its install)", () => {
  // only the plain file names before the "...[500, ...]" font spread (the fonts folder is copied as a whole)
  const body = read("sw.js").match(/const FILES = \[([\s\S]*?)\n\];/)[1].split("...")[0];
  const files = [...body.matchAll(/"([^"$]+)"/g)].map(m => m[1]).filter(f => f !== "./");
  const missing = files.filter(f => !published.has(f));
  assert.deepEqual(missing, [], `precached but not published: ${missing.join(", ")}`);
});
ok("version.json is published (the update check reads it)", () => assert.ok(published.has("version.json")));
console.log(`\n${t} tests passed`);
