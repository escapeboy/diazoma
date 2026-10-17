import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/strings/en.js';
import bg from '../src/strings/bg.js';

const ROOT = join(__dirname, '..');

describe('default strings', () => {
    it('English and Bulgarian have the same keys', () => {
        expect(Object.keys(bg).sort()).toEqual(Object.keys(en).sort());
    });

    it('keep the placeholder tokens of the shipped labels', () => {
        expect(en.saved_to).toContain(':board');
        expect(bg.saved_to).toContain(':board');
        expect(en.card_position).toContain(':total');
        expect(en.embed_notice).toContain(':provider');
    });

    it('use generic wording', () => {
        for (const v of Object.values(en)) expect(v.replace(/:[a-z]+/g, '')).not.toMatch(/\b[Pp]ins?\b|\b[Bb]oards?\b/);
    });
});

function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
        if (f === 'node_modules' || f === 'dist') continue;
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(js|ts|mjs|json|html|md)$/.test(f)) out.push(p);
    }
    return out;
}

describe('the package names no site', () => {
    // Built from fragments so this file does not contain the words itself.
    const forbidden = new RegExp(['po' + 'rn', 'pin' + 'love', 'nu' + 'de', 'ad' + 'ult', 'xx' + 'x', 'nsf' + 'w'].join('|'), 'i');
    it('has no site-specific word in sources, harness or tests', () => {
        const hits = walk(ROOT)
            .filter((p) => !p.includes('/baselines/') && !p.endsWith('package.json') && !p.includes('/harness/out/'))
            .filter((p) => forbidden.test(readFileSync(p, 'utf8')));
        expect(hits).toEqual([]);
    });
});
