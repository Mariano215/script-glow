// Installed packages the app never loads, so desktop/builder.cjs leaves them out of the build and
// THIRD_PARTY_NOTICES.md does not list them: onnxruntime-web (the browser runtime of transformers.js,
// whose Node build marks it "ignored") and every package only it depends on.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DROPPED = ['onnxruntime-web'];

function notShipped() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages;
  const reach = skip => {
    const found = new Set(), waiting = Object.keys(lock[''].dependencies ?? {});
    while (waiting.length) {
      const name = waiting.shift(), entry = lock[`node_modules/${name}`];
      if (found.has(name) || skip.includes(name) || !entry) continue;
      found.add(name);
      waiting.push(...Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }));
    }
    return found;
  };
  const kept = reach(DROPPED);
  return [...reach([])].filter(name => !kept.has(name)).sort();
}

module.exports = { notShipped };
