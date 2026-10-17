import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigateTo } from '../src/scene/Gallery.js';

describe('Gallery navigateTo (the default openItem)', () => {
    beforeEach(() => vi.stubGlobal('window', { location: { href: 'https://example.test/xr' } }));
    afterEach(() => vi.unstubAllGlobals());

    it('follows http(s) and relative links', () => {
        expect(navigateTo('/item/1', undefined)).toBe(true);
        expect(window.location.href).toBe('https://example.test/item/1');
        expect(navigateTo('http://other.test/p', undefined)).toBe(true);
        expect(window.location.href).toBe('http://other.test/p');
    });

    it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', 'java\nscript:alert(1)'])('refuses %j and reports it', (link) => {
        const track = vi.fn();
        expect(navigateTo(link, track)).toBe(false);
        expect(window.location.href).toBe('https://example.test/xr');
        expect(track).toHaveBeenCalledWith('xr_error', { props: expect.objectContaining({ name: 'BlockedNavigation' }) });
    });
});
