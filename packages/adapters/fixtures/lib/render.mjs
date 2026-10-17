const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * One annotated listing page (spec Level 1). `lazy` writes data-src instead of src, the pattern of
 * lazy-loading sites, so the page itself does not request the images.
 */
export function renderListing({ title, items, image, link, next, lazy = false, extraHead = '', extraBody = '' }) {
    const lis = items
        .map((p) => {
            const src = lazy ? 'data-src' : 'src';
            const thumb = image(p, 'thumb');
            const large = image(p, 'large');
            return `    <li class="card" data-wall-item data-wall-id="${esc(p.id)}" data-wall-link="${esc(link(p))}" data-wall-aspect="${p.aspect}"${p.badges.length ? ` data-wall-badges="${p.badges.join(',')}"` : ''}>
      <a href="${esc(link(p))}"><img data-wall-image ${src}="${esc(thumb)}" data-wall-image-focus="${esc(large)}" alt="${esc(p.title)}" width="192" height="${Math.round(192 / p.aspect)}"></a>
      <h3 data-wall-title>${esc(p.title)}</h3>
      <span data-wall-subtitle>${esc(p.subtitle)}</span>
    </li>`;
        })
        .join('\n');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f6f4ee; color: #222; }
  main { max-width: 960px; margin: 0 auto; padding: 24px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
  .card img { width: 100%; height: auto; display: block; }
  .card h3 { margin: 6px 0 0; font-size: 15px; }
  .card span { font-size: 13px; color: #666; }
  .pagination { margin-top: 24px; }
</style>
${extraHead}</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <ul data-wall-list data-wall-next="a.pagination__next">
${lis}
  </ul>
  <p class="pagination">${next ? `<a class="pagination__next" rel="next" href="${esc(next)}">Next page</a>` : ''}</p>
</main>
${extraBody}</body>
</html>
`;
}

export const stage = `<div id="diazoma"></div>
<style>#diazoma { position: fixed; inset: 0; } #diazoma canvas { display: block; }</style>
`;
export const loader = (extra = '') => `<script src="/bundle/loader.js" data-core="/bundle/wall.iife.js" data-mount="#diazoma" data-title="Step inside the prints" data-body="Botanical prints, all around you in VR."${extra}></script>`;

