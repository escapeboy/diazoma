import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Texture, Vector3 } from 'three';
import { embedUrl } from '../src/scene/video/embed.js';
import { createImmersive, immersiveGeometry, isImmersive } from '../src/scene/video/immersive.js';

describe('embedUrl', () => {
    it('keeps youtube-nocookie and adds autoplay', () => {
        const u = new URL(embedUrl('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ'));
        expect(u.origin + u.pathname).toBe('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ');
        expect(u.searchParams.get('autoplay')).toBe('1');
        expect(u.searchParams.get('playsinline')).toBe('1');
    });

    it('rewrites youtube.com/embed to youtube-nocookie', () => {
        expect(embedUrl('https://www.youtube.com/embed/aqz-KE-bpKQ?start=10')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/aqz-KE-bpKQ\?/);
    });

    it('keeps the Vimeo h= hash only', () => {
        const u = new URL(embedUrl('https://player.vimeo.com/video/76979871?h=8272103f6e&foo=bar'));
        expect(u.pathname).toBe('/video/76979871');
        expect(u.searchParams.get('h')).toBe('8272103f6e');
        expect(u.searchParams.get('foo')).toBeNull();
        expect(u.searchParams.get('autoplay')).toBe('1');
    });

    it('keeps a mixed-case Vimeo hash (same rule as the adapters and the PHP plugins: [A-Za-z0-9]{1,32})', () => {
        expect(new URL(embedUrl('https://player.vimeo.com/video/123?h=AbCdEfXyZ1')).searchParams.get('h')).toBe('AbCdEfXyZ1');
        expect(new URL(embedUrl('https://player.vimeo.com/video/123?h=' + 'a'.repeat(33))).searchParams.get('h')).toBeNull();
        expect(new URL(embedUrl('https://player.vimeo.com/video/123?h=ab-cd')).searchParams.get('h')).toBeNull();
    });

    it.each([
        'http://www.youtube-nocookie.com/embed/aqz-KE-bpKQ',
        'https://www.youtube.com.evil.example/embed/aqz-KE-bpKQ',
        'https://youtube.com/embed/aqz-KE-bpKQ',
        'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        'https://www.youtube-nocookie.com/embed/short',
        'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ/extra',
        'https://player.vimeo.com/video/abc',
        'https://vimeo.com/76979871',
        'https://user@player.vimeo.com/video/76979871',
        'https://player.vimeo.com:8443/video/76979871',
        'javascript:alert(1)',
        '',
        undefined,
    ])('refuses %s', (raw) => {
        expect(embedUrl(raw)).toBeNull();
    });
});

describe('immersive', () => {
    it('isImmersive only for equirect projections', () => {
        expect(isImmersive({ projection: 'equirect360' })).toBe(true);
        expect(isImmersive({ projection: 'equirect180' })).toBe(true);
        expect(isImmersive({ projection: 'flat' })).toBe(false);
        expect(isImmersive({})).toBe(false);
    });

    it('180° covers half a turn, 360° a full turn', () => {
        expect(immersiveGeometry('equirect180', 'mono').parameters.phiLength).toBeCloseTo(Math.PI);
        expect(immersiveGeometry('equirect360', 'mono').parameters.phiLength).toBeCloseTo(Math.PI * 2);
    });

    it('the picture centre (u = 0.5, v = 0.5) is straight ahead (−Z) once turned, for 360 and 180', () => {
        for (const projection of ['equirect360', 'equirect180']) {
            const im = createImmersive({ texture: new Texture(), projection, stereo: 'mono' });
            const mesh = im.meshes[0];
            mesh.updateMatrixWorld(true);
            const pos = mesh.geometry.attributes.position;
            const uv = mesh.geometry.attributes.uv;
            let best = -1;
            let bestD = Infinity;
            for (let i = 0; i < uv.count; i++) {
                const d = Math.hypot(uv.getX(i) - 0.5, uv.getY(i) - 0.5);
                if (d < bestD) { bestD = d; best = i; }
            }
            const p = new Vector3().fromBufferAttribute(pos, best).applyMatrix4(mesh.matrixWorld).normalize();
            expect(p.z).toBeLessThan(-0.99);
            // and u grows to the right (+X) seen from inside
            const left = new Vector3();
            const right = new Vector3();
            for (let i = 0; i < uv.count; i++) {
                if (Math.abs(uv.getY(i) - 0.5) > 0.02) continue;
                const q = new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
                if (Math.abs(uv.getX(i) - 0.25) < 0.02) left.copy(q);
                if (Math.abs(uv.getX(i) - 0.75) < 0.02) right.copy(q);
            }
            expect(left.x).toBeLessThan(0);
            expect(right.x).toBeGreaterThan(0);
            im.dispose();
        }
    });

    it('sbs: halves of u, left on layer 1, right on layer 2; tb: top half is the left eye', () => {
        const im = createImmersive({ texture: new Texture(), projection: 'equirect180', stereo: 'sbs' });
        const [l, r] = im.meshes;
        expect(l.layers.mask).toBe(1 << 1);
        expect(r.layers.mask).toBe(1 << 2);
        const range = (m, axis) => {
            const a = m.geometry.attributes.uv;
            let lo = Infinity;
            let hi = -Infinity;
            for (let i = 0; i < a.count; i++) { const x = axis ? a.getY(i) : a.getX(i); lo = Math.min(lo, x); hi = Math.max(hi, x); }
            return [lo, hi];
        };
        expect(range(l, 0)).toEqual([0, 0.5]);
        expect(range(r, 0)).toEqual([0.5, 1]);
        const tb = createImmersive({ texture: new Texture(), projection: 'equirect360', stereo: 'tb' });
        expect(range(tb.meshes[0], 1)).toEqual([0.5, 1]);
        expect(range(tb.meshes[1], 1)).toEqual([0, 0.5]);
    });

    it('mono stays on layer 0; the page camera sees the left eye only outside XR, and gets it back on dispose', () => {
        const mono = createImmersive({ texture: new Texture(), projection: 'equirect360', stereo: 'mono' });
        expect(mono.meshes).toHaveLength(1);
        expect(mono.meshes[0].layers.mask).toBe(1);
        const cam = new PerspectiveCamera();
        const st = createImmersive({ texture: new Texture(), projection: 'equirect360', stereo: 'sbs' });
        st.update(cam, false, new Vector3(0, 1.6, 0));
        expect(cam.layers.isEnabled(1)).toBe(true);
        expect(st.group.position.y).toBeCloseTo(1.6);
        st.update(cam, true);
        expect(cam.layers.isEnabled(1)).toBe(false);
        st.update(cam, false);
        st.dispose(cam);
        expect(cam.layers.isEnabled(1)).toBe(false);
    });
});
