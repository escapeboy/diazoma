#!/usr/bin/env node
import { formatReport } from './format.js';
import { validate } from './validate.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const [cmd, url] = args.filter((a) => !a.startsWith('--'));

if (cmd !== 'validate' || !url) {
    console.error('usage: diazoma-spec validate <url> [--json]\n\nChecks a site against the Diazoma site-compatibility spec v1 and prints the ladder.\nExit 0 when the highest detected level passes, 1 when it fails, 2 on bad usage.');
    process.exit(2);
}
let target: string;
try {
    target = new URL(url).href;
} catch {
    console.error(`not a URL: ${url}`);
    process.exit(2);
}
const report = await validate(target);
console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
process.exit(report.ok ? 0 : 1);
