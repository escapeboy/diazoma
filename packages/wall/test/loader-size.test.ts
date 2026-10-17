import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = join(__dirname, '..');

describe('loader', () => {
    beforeAll(() => {
        execSync('pnpm exec vite build --config vite.loader.config.ts', { cwd: ROOT, stdio: 'pipe' });
    }, 60000);

    it('is at most 3 KB gzipped (level 9)', () => {
        const gz = gzipSync(readFileSync(join(ROOT, 'dist/loader.js')), { level: 9 }).length;
        expect(gz).toBeLessThanOrEqual(3072);
    });

    it('holds no three.js', () => {
        const code = readFileSync(join(ROOT, 'dist/loader.js'), 'utf8');
        expect(code).not.toMatch(/WebGLRenderer|PerspectiveCamera/);
    });

    it('keeps the headset entry contract: offerSession and the session features', () => {
        const code = readFileSync(join(ROOT, 'dist/loader.js'), 'utf8');
        expect(code).toContain('offerSession');
        expect(code).toContain('isSessionSupported');
        expect(code).toContain('local-floor');
        expect(code).toContain('bounded-floor');
        expect(code).toContain('hand-tracking');
    });
});
