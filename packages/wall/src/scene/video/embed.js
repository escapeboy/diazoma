/**
 * YouTube and Vimeo players outside VR. Only embed URLs on an exact allowlist are shown, as an
 * iframe in a DOM overlay over the wall; anything else keeps the "watch in the browser" notice.
 * An immersive session cannot show an iframe, so the wall removes the overlay when one starts.
 */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d+$/;
// Same rule as the adapters and both PHP plugins.
const VIMEO_HASH = /^[A-Za-z0-9]{1,32}$/;

/** The canonical embed URL (with autoplay) for an allowlisted `unplayable.embed`, else null. */
export function embedUrl(raw) {
    let u;
    try {
        u = new URL(String(raw || ''));
    } catch (e) {
        return null;
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if ((u.hostname === 'www.youtube-nocookie.com' || u.hostname === 'www.youtube.com') && parts.length === 2 && parts[0] === 'embed' && YOUTUBE_ID.test(parts[1])) {
        const out = new URL('https://www.youtube-nocookie.com/embed/' + parts[1]);
        out.searchParams.set('autoplay', '1');
        out.searchParams.set('playsinline', '1');
        out.searchParams.set('rel', '0');
        return out.href;
    }
    if (u.hostname === 'player.vimeo.com' && parts.length === 2 && parts[0] === 'video' && VIMEO_ID.test(parts[1])) {
        const out = new URL('https://player.vimeo.com/video/' + parts[1]);
        const h = u.searchParams.get('h');
        if (h && VIMEO_HASH.test(h)) out.searchParams.set('h', h);
        out.searchParams.set('autoplay', '1');
        return out.href;
    }
    return null;
}

/**
 * Shows `url` in an overlay over `mount`. Close button, Esc, Tab kept inside, focus given back on
 * close. Returns `{ root, iframe, close() }`; `onClose` runs once, however it was closed.
 *
 * While focus is inside the cross-origin iframe its key presses go to the player, not to this page:
 * Esc cannot be caught there. The close button stays visible and focusable (Tab from the player
 * reaches it; Shift+Tab lands on a sentinel that hands focus to it).
 */
export function openEmbed({ mount, url, title = '', labels = {}, onClose = () => {} }) {
    const doc = mount.ownerDocument || document;
    const before = doc.activeElement;
    const root = doc.createElement('div');
    root.className = 'diazoma-embed';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', title || labels.dialog || 'Video');
    root.style.cssText = 'position:fixed;z-index:2147482500;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:56px 16px 16px;background:rgba(6,6,8,.88)';

    const frameBox = doc.createElement('div');
    frameBox.style.cssText = 'position:relative;width:100%;max-width:100%;max-height:100%;aspect-ratio:16/9';
    const iframe = doc.createElement('iframe');
    iframe.src = url;
    iframe.title = title || labels.dialog || 'Video';
    iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute('allowfullscreen', '');
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px;background:#000';
    frameBox.appendChild(iframe);

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕ ' + (labels.close || 'Close');
    closeBtn.setAttribute('aria-label', labels.close || 'Close');
    closeBtn.style.cssText = 'position:absolute;top:10px;right:12px;min-height:40px;padding:0 18px;border:0;border-radius:999px;background:#f4f3f2;color:#111;font:600 16px system-ui,sans-serif;cursor:pointer';
    // Shift+Tab out of the player lands here and goes on to the close button, so focus stays in the overlay.
    const sentinel = doc.createElement('div');
    sentinel.tabIndex = 0;
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0';
    sentinel.addEventListener('focus', () => closeBtn.focus());
    root.append(sentinel, frameBox, closeBtn);

    const place = () => {
        const r = mount.getBoundingClientRect();
        Object.assign(root.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        // Fit 16:9 inside the box under the close button.
        const w = Math.max(0, Math.min(r.width - 32, ((r.height - 72) * 16) / 9));
        frameBox.style.width = w + 'px';
    };
    place();

    let closed = false;
    const view = doc.defaultView || window;
    const onKey = (e) => {
        // The wall's own keys must not act while the player has focus.
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        } else if (e.key === 'Tab') {
            const order = [closeBtn, iframe];
            const i = order.indexOf(doc.activeElement);
            e.preventDefault();
            order[(i + (e.shiftKey ? order.length - 1 : 1) + order.length) % order.length].focus();
        }
    };
    root.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', () => close());
    view.addEventListener('resize', place);
    // A mount inside a scrolling page moves with it: follow any scroll (capture sees nested scrollers too).
    view.addEventListener('scroll', place, true);

    function close() {
        if (closed) return;
        closed = true;
        view.removeEventListener('resize', place);
        view.removeEventListener('scroll', place, true);
        root.removeEventListener('keydown', onKey);
        // Stop the remote player before the node goes, so no sound outlives the overlay.
        iframe.src = 'about:blank';
        root.remove();
        if (before && typeof before.focus === 'function' && doc.contains(before)) before.focus();
        onClose();
    }

    doc.body.appendChild(root);
    closeBtn.focus();
    return { root, iframe, close };
}
