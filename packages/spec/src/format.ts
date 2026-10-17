import type { Report, Status } from './validate.js';

const TAG: Record<Status, string> = { pass: 'pass', fail: 'FAIL', warn: 'warn', info: 'info' };

/** The ladder as text: one line per level, one per check. */
export function formatReport(r: Report): string {
    const lines = [`diazoma-spec validate ${r.url}`, ''];
    for (const l of r.levels) {
        const state = l.status === 'not-detected' ? 'not detected' : l.status === 'pass' ? 'PASS' : 'FAIL';
        lines.push(`Level ${l.level}  ${l.name.padEnd(16)} ${state}`);
        for (const c of l.checks) lines.push(`    ${TAG[c.status].padEnd(4)}  ${c.name}${c.detail ? ': ' + c.detail : ''}`);
    }
    lines.push('');
    if (r.policy) lines.push(`policy: ${r.policy}`);
    lines.push(r.highest ? `Highest detected level: ${r.highest}. Result: ${r.ok ? 'PASS' : 'FAIL'}` : 'No level detected. Result: FAIL');
    return lines.join('\n');
}
