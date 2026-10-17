import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { validate, type Report } from '../src/validate';
import { formatReport } from '../src/format';
import { contrastOnWhite, contrastRatio } from '../src/contrast';
import { fixtureDir, PACKAGE } from './helpers';
// @ts-expect-error plain JS helper of the fixtures
import { serveFixture } from '../../adapters/fixtures/lib/serve.mjs';

type Served = Awaited<ReturnType<typeof serveFixture>>;
const run = promisify(execFile);
const CLI = path.join(PACKAGE, 'dist/cli.js');
const cli = async (...args: string[]) => {
    try {
        const r = await run('node', [CLI, ...args]);
        return { code: 0, out: r.stdout, err: r.stderr };
    } catch (e) {
        const x = e as { code: number; stdout: string; stderr: string };
        return { code: x.code, out: x.stdout, err: x.stderr };
    }
};
const level = (r: Report, n: number) => r.levels.find((l) => l.level === n)!;
const check = (r: Report, n: number, name: string) => level(r, n).checks.find((c) => c.name.startsWith(name))!;

let l1: Served;
let l2: Served;
let broken: Served;
beforeAll(async () => {
    l1 = await serveFixture(fixtureDir('level1-listing'));
    l2 = await serveFixture(fixtureDir('level2-feed'));
    broken = await serveFixture(fixtureDir('broken'));
});
afterAll(async () => {
    await Promise.all([l1.close(), l2.close(), broken.close()]);
});

describe('level1-listing', () => {
    it('passes at Level 1 and detects nothing above it', async () => {
        const r = await validate(l1.origin + '/');
        expect(r).toMatchObject({ highest: 1, ok: true });
        expect(level(r, 3).detected).toBe(false);
        expect(level(r, 2).detected).toBe(false);
        expect(check(r, 1, 'items').detail).toBe('24 [data-wall-item]');
        expect(check(r, 1, 'pagination').detail).toContain('page2.html');
    });
    it('CLI: exit 0 and the ladder on stdout', async () => {
        const r = await cli('validate', l1.origin + '/');
        expect(r.code).toBe(0);
        expect(r.out).toContain('Level 1  annotations      PASS');
        expect(r.out).toContain('Result: PASS');
    });
});

describe('level2-feed', () => {
    it('passes at Level 2: manifest, feeds, CORS, contrast, policy', async () => {
        const r = await validate(l2.origin + '/');
        expect(r).toMatchObject({ highest: 2, ok: true, policy: 'allow' });
        expect(check(r, 2, 'manifest').status).toBe('pass');
        expect(check(r, 2, 'feed latest').detail).toContain('24 items');
        expect(check(r, 2, 'feed popular').status).toBe('pass');
        expect(check(r, 2, 'feed search').status).toBe('info');
        expect(check(r, 2, 'CORS').status).toBe('pass');
        expect(check(r, 2, 'brand.accent').status).toBe('pass');
        expect(level(r, 1).detected).toBe(false);
    });
    it('CLI --json prints the report and exits 0', async () => {
        const r = await cli('validate', l2.origin + '/', '--json');
        expect(r.code).toBe(0);
        expect(JSON.parse(r.out)).toMatchObject({ highest: 2, ok: true });
    });
    it('finds the well-known manifest without a <link>', async () => {
        const noLink = http.createServer((req, res) => {
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body>plain</body></html>');
                return;
            }
            // proxy the fixture's manifest and feed
            res.writeHead(302, { Location: l2.origin + req.url });
            res.end();
        });
        await new Promise<void>((ok) => noLink.listen(0, '127.0.0.1', ok));
        const port = (noLink.address() as { port: number }).port;
        const r = await validate(`http://127.0.0.1:${port}/`);
        noLink.close();
        expect(level(r, 2).detected).toBe(true);
    });
});

describe('broken fixture', () => {
    it('fails Level 2 with the three expected problems', async () => {
        const r = await validate(broken.origin + '/');
        expect(r).toMatchObject({ highest: 2, ok: false });
        expect(check(r, 2, 'manifest').status).toBe('pass');
        const feed = check(r, 2, 'feed latest');
        expect(feed.status).toBe('fail');
        expect(feed.detail).toContain('/items/1');
        expect(feed.detail).toContain("'image'");
        const cors = check(r, 2, 'CORS');
        expect(cors.status).toBe('fail');
        expect(cors.detail).toContain('missing');
        const contrast = check(r, 2, 'brand.accent');
        expect(contrast.status).toBe('fail');
        expect(contrast.detail).toContain('#4a1f2a on #1b1b1f is 1.24:1');
    });
    it('CLI: exit 1 and FAIL lines', async () => {
        const r = await cli('validate', broken.origin + '/');
        expect(r.code).toBe(1);
        expect(r.out).toMatch(/FAIL {2}feed latest/);
        expect(r.out).toMatch(/FAIL {2}CORS/);
        expect(r.out).toMatch(/FAIL {2}brand\.accent contrast/);
        expect(r.out).toContain('Result: FAIL');
    });
});

describe('other cases', () => {
    const page = (html: string, extra?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean) => {
        const s = http.createServer((req, res) => {
            if (extra?.(req, res)) return;
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        return new Promise<{ url: string; close: () => void }>((ok) => s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}/`, close: () => s.close() })));
    };

    it('Level 0: nothing annotated, no manifest, no feed link: no level, exit 1', async () => {
        const s = await page('<html><body><p>hello</p></body></html>');
        const r = await validate(s.url);
        const out = await cli('validate', s.url);
        s.close();
        expect(r).toMatchObject({ highest: 0, ok: false });
        expect(out.code).toBe(1);
        expect(out.out).toContain('No level detected');
    });
    it('Level 3: finds the embed script, says window.__diazoma is not checked, and checks the declared manifest', async () => {
        const s = await page('<html><body><script src="/wall.iife.js" data-manifest="/.well-known/wall.json" data-route="/xr"></script></body></html>', (req, res) => {
            if (req.url === '/.well-known/wall.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }] }));
                return true;
            }
            if (req.url === '/f.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ items: [{ id: '1', link: '/1', image: '/1.png', aspect: 1 }] }));
                return true;
            }
            return false;
        });
        const r = await validate(s.url);
        s.close();
        expect(r).toMatchObject({ highest: 3, ok: true });
        expect(level(r, 3).checks.find((c) => c.name === 'window.__diazoma')!.detail).toContain('not checked');
        expect(level(r, 2).status).toBe('pass');
    });
    it('Level 3: recognises the diazoma-embed.js tag, with or without data-manifest', async () => {
        for (const tag of ['<script src="https://cdn.test/diazoma-embed.js"></script>', '<script src="/diazoma-embed.js?v=2"></script>']) {
            const s = await page(`<html><body>${tag}</body></html>`);
            const r = await validate(s.url);
            s.close();
            expect(level(r, 3).detected, tag).toBe(true);
        }
    });
    it('Level 2 without a manifest: validates the feed named by <link rel="wall-feed">', async () => {
        const s = await page('<html><head><link rel="wall-feed" href="/f.json" title="Latest"></head></html>', (req, res) => {
            if (req.url === '/f.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ items: [{ id: '1', link: '/1', image: '/1.png', aspect: 1 }] }));
                return true;
            }
            return false;
        });
        const r = await validate(s.url);
        s.close();
        expect(r).toMatchObject({ highest: 2, ok: true });
        expect(check(r, 2, 'feed Latest').status).toBe('pass');
    });
    it('reports Level 1 items without image or link, and a data-wall-next that matches nothing', async () => {
        const s = await page('<ul data-wall-next="a.nope"><li data-wall-item><a href="/a">x</a></li><li data-wall-item><img src="/b.png"></li></ul>');
        const r = await validate(s.url);
        s.close();
        expect(r.ok).toBe(false);
        expect(check(r, 1, 'image on every item').detail).toBe('1 of 2 items have no image');
        expect(check(r, 1, 'link on every item').detail).toBe('1 of 2 items have no link');
        expect(check(r, 1, 'pagination').status).toBe('fail');
    });
    it('CORS passes when the host echoes the page origin and fails when it names another origin', async () => {
        const mk = (allow: (origin: string | undefined) => string | undefined) => page('<html><head><link rel="wall-manifest" href="/m.json"></head></html>', (req, res) => {
            const origin = req.headers.origin as string | undefined;
            if (req.url === '/m.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }], media: { hosts: [req.headers.host] } }));
                return true;
            }
            if (req.url === '/f.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ items: [{ id: '1', link: '/1', image: '/i.png', aspect: 1 }] }));
                return true;
            }
            if (req.url === '/i.png') {
                const acao = allow(origin);
                res.writeHead(200, { 'Content-Type': 'image/png', ...(acao ? { 'Access-Control-Allow-Origin': acao } : {}) });
                res.end('x');
                return true;
            }
            return false;
        });
        const echo = await mk((o) => o);
        const r1 = await validate(echo.url);
        echo.close();
        expect(check(r1, 2, 'CORS').status).toBe('pass');
        expect(check(r1, 2, 'CORS').detail).toContain(new URL(echo.url).origin);
        const other = await mk(() => 'https://other.example');
        const r2 = await validate(other.url);
        other.close();
        expect(check(r2, 2, 'CORS').status).toBe('fail');
        expect(check(r2, 2, 'CORS').detail).toContain('"https://other.example"');
    });
    it('an out-of-range view in the manifest is a FAIL that names the field', async () => {
        const s = await page('<html><head><link rel="wall-manifest" href="/m.json"></head></html>', (req, res) => {
            if (req.url === '/m.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ version: 1, feeds: [{ id: 'f', url: '/f.json' }], view: { wall: { rows: 9 } } }));
                return true;
            }
            return false;
        });
        const r = await validate(s.url);
        s.close();
        expect(r.ok).toBe(false);
        expect(check(r, 2, 'manifest').status).toBe('fail');
        expect(check(r, 2, 'manifest').detail).toContain('/view/wall/rows');
        expect(formatReport(r)).toContain('/view/wall/rows');
    });
    it('policy deny is printed', async () => {
        const s = await page('<html><head><link rel="wall-manifest" href="/m.json"></head></html>', (req, res) => {
            if (req.url === '/m.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ version: 1, policy: 'deny', feeds: [{ id: 's', type: 'search', url: '/s?q={query}' }] }));
                return true;
            }
            return false;
        });
        const r = await validate(s.url);
        s.close();
        expect(r.policy).toBe('deny');
        expect(formatReport(r)).toContain('policy: deny');
    });
    it('an unreachable page is a failing check, not a crash; bad usage exits 2', async () => {
        const r = await validate('http://127.0.0.1:1/');
        expect(r.ok).toBe(false);
        expect((await cli('validate')).code).toBe(2);
        expect((await cli('validate', 'not a url')).code).toBe(2);
    });
});

describe('contrast', () => {
    it('matches known WCAG ratios against white', () => {
        expect(contrastOnWhite('#000')!).toBeCloseTo(21, 1);
        expect(contrastOnWhite('#ffffff')!).toBeCloseTo(1, 2);
        expect(contrastOnWhite('#767676')!).toBeGreaterThanOrEqual(4.5);
        expect(contrastOnWhite('#777777')!).toBeLessThan(4.5);
        expect(contrastOnWhite('red')).toBeNull();
    });
    it('measures the accent against the wall background', () => {
        expect(contrastRatio('#c9334f', '#0e0e10')!).toBeLessThan(4.5);
        expect(contrastRatio('#e0556f', '#0e0e10')!).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio('#0e0e10', '#e0556f')).toBeCloseTo(contrastRatio('#e0556f', '#0e0e10')!, 6);
        expect(contrastRatio('red', '#000')).toBeNull();
    });
});
