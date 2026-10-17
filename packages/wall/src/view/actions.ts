import type { ActionId, ActionView, Item, LabelField, PanelField, PanelLine, Strings, ViewHooks } from '../types';
import { LIMITS, truncate } from './resolveView';

/** An account (with an id) reads as @handle; a bare label is an artist's or author's name. */
export const creatorName = (creator?: { id?: string; label: string }): string =>
    creator?.label ? (creator.id ? '@' : '') + creator.label : '';

/** Adapter actions that are steps of another action, never a button of their own. */
const INTERNAL = new Set(['create-and-save']);

type Views = Record<string, ActionView>;

/**
 * The actions this item shows, in order: the site's declared actions, narrowed by `item.actions`,
 * without hidden ones, sorted by `order` then declaration. `follow` follows the item's collection
 * from the side column unless the site places it in the column itself. A hook may reorder or drop
 * ids, never add one the site did not declare.
 */
export function actionIds(declared: ActionId[], item: Item, views: Views, hook?: ViewHooks['actions']): ActionId[] {
    let ids = declared.filter((id, i) => typeof id === 'string' && !INTERNAL.has(id) && declared.indexOf(id) === i);
    ids = ids.filter((id) => id !== 'follow' || (views.follow?.placement !== undefined && views.follow.placement !== 'hidden'));
    if (Array.isArray(item.actions)) {
        const allowed = new Set(item.actions.filter((x) => typeof x === 'string'));
        ids = ids.filter((id) => allowed.has(id));
    }
    ids = ids.filter((id) => views[id]?.placement !== 'hidden');
    ids = ids
        .map((id, i) => ({ id, i, o: views[id]?.order ?? Infinity }))
        .sort((a, b) => (a.o === b.o ? a.i - b.i : a.o - b.o))
        .map((x) => x.id);
    if (hook) {
        const out = hook(item, [...ids]);
        if (Array.isArray(out)) ids = out.filter((id, i) => ids.includes(id) && out.indexOf(id) === i);
    }
    return ids;
}

/**
 * Which buttons sit in the column and which behind "More". Explicit `primary` placements win
 * (at most three); without any, the first two that are not placed under "More".
 */
export function placeActions(ids: ActionId[], views: Views): { primary: ActionId[]; more: ActionId[] } {
    const explicit = ids.filter((id) => views[id]?.placement === 'primary');
    const primary = explicit.length ? explicit.slice(0, LIMITS.primary) : ids.filter((id) => views[id]?.placement !== 'more').slice(0, 2);
    return { primary, more: ids.filter((id) => !primary.includes(id)) };
}

/** Key in `item.state` that says the action is on. */
export function stateKey(id: ActionId, view?: ActionView): string {
    return view?.state ?? (id === 'like' ? 'liked' : id);
}

/** Like keeps its shipped flag (`_liked`, set from `state.liked`); every other action reads `item.state`. */
export function isActive(item: Item & { _liked?: boolean }, id: ActionId, view?: ActionView): boolean {
    const key = stateKey(id, view);
    if (key === 'liked') return !!item._liked;
    return !!item.state?.[key];
}

function humanize(id: string): string {
    const words = id.replace(/[-_]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function builtIn(id: ActionId, strings: Strings): ActionView {
    switch (id) {
        case 'like': return { icon: '♡', iconActive: '♥', label: strings.like, labelActive: strings.liked };
        case 'save': return { icon: '📌', label: strings.save };
        case 'follow': return { icon: '★', iconActive: '✓', label: strings.action_follow || 'Follow', labelActive: strings.action_follow_active || 'Following' };
        default: return { label: strings['action_' + id] || humanize(id), labelActive: strings['action_' + id + '_active'] };
    }
}

/** The face of an action button: its label and whether it is drawn filled. */
export function actionFace(id: ActionId, item: Item & { _liked?: boolean }, view: ActionView | undefined, strings: Strings, hook?: ViewHooks['actionLabel']): { label: string; filled: boolean; active: boolean } {
    const active = isActive(item, id, view);
    const filled = active || view?.style === 'primary';
    const fromHook = hook ? hook(id, item, active) : undefined;
    if (typeof fromHook === 'string' && fromHook.trim()) return { label: truncate(fromHook.trim(), LIMITS.label + 4), filled, active };
    const base = builtIn(id, strings);
    const icon = active ? view?.iconActive ?? view?.icon ?? base.iconActive ?? base.icon : view?.icon ?? base.icon;
    const text = (active ? view?.labelActive ?? view?.label ?? base.labelActive ?? base.label : view?.label ?? base.label) || humanize(id);
    let label = icon ? `${icon} ${text}` : text;
    if (view?.count) {
        const n = (item as unknown as Record<string, unknown>)[view.count] ?? item.state?.[view.count];
        if (typeof n === 'number' && Number.isFinite(n)) label += ` · ${n}`;
    }
    return { label, filled, active };
}

export interface StyledLine {
    text: string;
    style: NonNullable<PanelLine['style']>;
}

function metaLine(key: string, value: unknown, labels: Record<string, string>): string | null {
    if (value === undefined || value === null || value === '') return null;
    return `${labels[key] ?? humanize(key)}: ${String(value)}`;
}

/** The viewer's longer text: `description`, else the `excerpt` of an item that has a picture (a text card shows its excerpt on the card). */
export function descriptionOf(item: Item): string | undefined {
    return item.description || (item.image ? item.excerpt : undefined) || undefined;
}

/** Lines of the info panel for the site's `panel.fields`. */
export function panelLines(item: Item, fields: PanelField[], metaLabels: Record<string, string>): StyledLine[] {
    const out: StyledLine[] = [];
    const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
    for (const f of fields) {
        if (f === 'title' && item.title) out.push({ text: item.title, style: 'title' });
        else if (f === 'subtitle' && item.subtitle) out.push({ text: item.subtitle, style: 'soft' });
        else if (f === 'creator' && item.creator?.label) out.push({ text: creatorName(item.creator), style: 'soft' });
        else if (f === 'collection' && item.collection?.label) out.push({ text: '▦ ' + item.collection.label, style: 'soft' });
        else if (f === 'description' && descriptionOf(item)) out.push({ text: descriptionOf(item) as string, style: 'body' });
        else if (f === 'likes' && typeof item.likes === 'number') out.push({ text: '♥ ' + item.likes, style: 'body' });
        else if (f === 'tags' && Array.isArray(item.tags) && item.tags.length) out.push({ text: item.tags.slice(0, 6).map((t) => '#' + t).join(' '), style: 'soft' });
        else if (f === 'badges' && Array.isArray(item.badges) && item.badges.length) out.push({ text: item.badges.join(' · '), style: 'accent' });
        else if (f === 'meta') {
            for (const [k, v] of Object.entries(meta)) {
                const line = metaLine(k, v, metaLabels);
                if (line) out.push({ text: line, style: 'body' });
            }
        } else if (f.startsWith('meta.')) {
            const line = metaLine(f.slice(5), meta[f.slice(5)], metaLabels);
            if (line) out.push({ text: line, style: 'body' });
        }
    }
    return out.slice(0, LIMITS.panelLines);
}

/** A hook's panel lines, cut to the limits; unknown styles become body text. */
export function hookLines(lines: unknown): StyledLine[] | null {
    if (!Array.isArray(lines)) return null;
    const styles = ['title', 'body', 'soft', 'accent'];
    return lines
        .filter((l): l is PanelLine => !!l && typeof l === 'object' && typeof (l as PanelLine).text === 'string')
        .slice(0, LIMITS.panelLines)
        .map((l) => ({ text: truncate(l.text, 120), style: (styles.includes(l.style as string) ? l.style : 'body') as StyledLine['style'] }));
}

/** Lines of the label on the focused card for the site's `wall.labelFields`. */
export function cardLabelLines(item: Item, fields: LabelField[], metaLabels: Record<string, string>, countLabel: string): string[] {
    const out: string[] = [];
    const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
    for (const f of fields) {
        if (f === 'title' && item.title) out.push(item.title);
        else if (f === 'subtitle' && item.subtitle) out.push(item.subtitle);
        else if (f === 'creator' && item.creator?.label) out.push(creatorName(item.creator));
        else if (f === 'count' && (item.kind === 'collection' || item.kind === 'tag')) out.push(countLabel.replace(':n', String(item.count || 0)));
        else if (f.startsWith('meta.')) {
            const line = metaLine(f.slice(5), meta[f.slice(5)], metaLabels);
            if (line) out.push(line);
        }
    }
    return out.slice(0, LIMITS.labelLines);
}
