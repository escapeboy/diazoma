#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runFixtures } from './fixtures.js';
import { expandTemplateDirs, writeExpanded } from './templates.js';

const [cmd, file, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
};

if (cmd === 'expand' && file && flag('--out')) {
    const list = expandTemplateDirs(path.resolve(file));
    writeExpanded(list, path.resolve(flag('--out')!));
    if (rest.includes('--json')) console.log(JSON.stringify(list.map((e) => e.id)));
    else console.log(`${list.length} recipes expanded`);
    process.exit(0);
}
if (cmd !== 'run' || !file) {
    console.error('usage: diazoma-recipe run <recipe.json> [--dir <fixtures base>] [--json]\n       diazoma-recipe expand <templates dir> --out <dir> [--json]');
    process.exit(2);
}
const dir = flag('--dir') ? path.resolve(flag('--dir')!) : path.dirname(path.resolve(file));
const report = await runFixtures(JSON.parse(readFileSync(file, 'utf8')), dir);
if (rest.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`recipe ${report.recipe}`);
    for (const e of report.schemaErrors) console.log(`  FAIL schema ${e}`);
    for (const r of report.results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.fixture}: ${r.items} items${r.problems.length ? ' (' + r.problems.slice(0, 3).join('; ') + ')' : ''}`);
    console.log(report.ok ? 'OK' : 'FAILED');
}
process.exit(report.ok ? 0 : 1);
