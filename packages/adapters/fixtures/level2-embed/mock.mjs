/**
 * Harness backend for level2-embed: the page is only the one-tag embed (xr.html has no mounting
 * script and no mount element). The manifest and the feeds are those of level2-feed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createLevel2 from '../level2-feed/mock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default function createMock(ctx) {
    const level2 = createLevel2(ctx);
    return {
        ...level2,
        async handle(req, res, url) {
            if (url.pathname === '/diazoma-embed.js') {
                res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(fs.readFileSync(path.join(HERE, '../../dist/diazoma-embed.js')));
                return true;
            }
            return level2.handle(req, res, url);
        },
    };
}
