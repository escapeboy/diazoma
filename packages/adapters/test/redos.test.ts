import { describe, expect, it } from 'vitest';
import { checkRegex, MAX_RE_INPUT } from '../src/regex';

/** Accepted patterns, each with the character that makes it backtrack most (a long run of it, then a miss). */
const accepted: [string, string][] = [
    ['^a*a*b', 'a'],
    ['^\\s*\\s*x', ' '],
    ['^a+a+b', 'a'],
    ['^\\d{1,9999}\\d{1,9999}x', '1'],
    ['^a{0,2048}a{0,2048}b', 'a'],
    ['^a{1,}a{1,}b', 'a'],
    ['^a?a?b', 'a'],
    ['^(a|a)(a|a)b', 'a'],
    ['^.*.*x', 'a'],
    ['^[a-z]*[a-z]*1', 'a'],
    ['a*b', 'a'],
    ['a+b', 'a'],
    ['\\s*x', ' '],
    ['\\d{1,9999}x', '1'],
    ['a{0,2048}b', 'a'],
    ['(?:a|aa)b', 'a'],
    ['^(.*)-3000(\\.png)$', '-'],
    ['(\\d{4})', '1'],
    ['Printed (\\d+)', ' '],
    ['Printed\\s+(\\d{4})', ' '],
];

const refused = [
    '\\d{1,9999}\\d{1,9999}\\d{1,9999}\\d{1,9999}x',
    'a{0,2048}a{0,2048}a{0,2048}b',
    'a*a*b',
    '\\s*\\s*x',
    '\\d{1,9999}\\d{1,9999}x',
    'a{0,2048}a{0,2048}b',
    '^a*a*a*b',
    '^\\s*\\s*\\s*x',
    'a?a?a?a?a?a?a?a?a?a?a?a?aaaaaaaaaaaa',
    '(a|a)(a|a)(a|a)(a|a)(a|a)(a|a)b',
    '(a|a)(a|a)b',
    '^a*a*b|c*c*d',
    '^a{0,5}a{0,5}a{0,5}b',
    '^a{2,}a{2,}a{2,}b',
];

describe('regex guard: every accepted pattern is fast on adversarial input of the maximum length', () => {
    it.each(accepted)('accepts and runs %s in under 50 ms', (re, ch) => {
        expect(checkRegex(re), re).toBeNull();
        const rx = new RegExp(re);
        for (const tail of ['!', '', 'x', 'c']) {
            const input = ch.repeat(MAX_RE_INPUT - tail.length) + tail;
            expect(input.length).toBeLessThanOrEqual(MAX_RE_INPUT);
            const t = performance.now();
            rx.exec(input);
            const ms = performance.now() - t;
            expect(ms, `${re} on ${JSON.stringify(ch)}x${input.length}+${JSON.stringify(tail)}`).toBeLessThan(50);
        }
    });
    it.each(refused)('refuses %s', (re) => {
        expect(checkRegex(re)).toMatch(/variable|repeated/);
    });
    it('counts {m,n} with n > m as variable, and {3} and {2,2} as fixed', () => {
        expect(checkRegex('^a{0,9}a{0,9}a{0,9}')).toMatch(/variable/);
        expect(checkRegex('a{3}a{3}a{2,2}a{4}b*')).toBeNull();
        expect(checkRegex('a*a{3}')).toBeNull();
    });
});
