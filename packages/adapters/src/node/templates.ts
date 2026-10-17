import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Recipe } from '../RecipeAdapter.js';

/**
 * A recipe template: one recipe for a platform that many sites run (PeerTube, MediaWiki), written once
 * with `{{name}}` placeholders and expanded for every entry of the folder's `hosts.json`. The result is
 * an ordinary recipe per host; consumers never see the template.
 */
export interface RecipeTemplate {
    template: string;
    version: number;
    /** A recipe without `id` and `version`. Its strings may use `{{host}}` and the entry's `vars`. */
    recipe: Omit<Recipe, 'id' | 'version'>;
    /** Strings may also use `{{name}}`. */
    meta?: { title?: string; description?: string };
}

export interface TemplateHost {
    host: string;
    /** Recipe id; defaults to the host. */
    id?: string;
    name?: string;
    vars?: Record<string, string>;
    /** Added to the template version, so a changed entry can raise its recipe's version alone. */
    revision?: number;
    /** https image URLs of this host's items, shown on its marketplace card. */
    previews?: string[];
}

export interface ExpandedRecipe {
    id: string;
    recipe: Recipe;
    /** `family` is the template name and `position` the host's index in hosts.json: the marketplace orders its catalog by them. */
    meta: { title: string; description: string; previews: string[]; family: string; position: number };
    /** The template folder: the recipe's fixtures are relative to it. */
    dir: string;
}

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/i;
// Starts with a letter or digit: an id is a directory name, so `.` and `..` must not pass.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// A value goes into URLs and match patterns as it is: one plain token, so it cannot add a query
// parameter, a path or a wildcard.
const VALUE = /^[A-Za-z0-9._~-]+$/;
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** Expands one template for each host. Throws on a bad entry, a duplicate id or an unknown placeholder. */
export function expandRecipeTemplate(template: RecipeTemplate, hosts: TemplateHost[], dir = '.'): ExpandedRecipe[] {
    if (!template.template || !Number.isInteger(template.version) || template.version < 1) throw new Error('template needs a name and a positive integer version');
    if ('id' in template.recipe || 'version' in template.recipe) throw new Error(`template ${template.template}: recipe must not set id or version`);
    const seen = new Set<string>();
    return hosts.map((h, i) => {
        const where = `template ${template.template}, host ${i} (${h?.host})`;
        if (typeof h?.host !== 'string' || !HOST.test(h.host)) throw new Error(`${where}: host is not a hostname`);
        const id = h.id ?? h.host;
        if (!ID.test(id)) throw new Error(`${where}: id ${id} must start with a letter or digit and use only [A-Za-z0-9._-]`);
        // Case-insensitive: the expanded recipes are directories, and some filesystems fold case.
        if (seen.has(id.toLowerCase())) throw new Error(`${where}: duplicate id ${id}`);
        seen.add(id.toLowerCase());
        const revision = h.revision ?? 0;
        if (!Number.isInteger(revision) || revision < 0) throw new Error(`${where}: revision must be a non-negative integer`);
        const vars: Record<string, string> = { host: h.host };
        for (const [k, v] of Object.entries(h.vars ?? {})) {
            if (k === 'host' || k === 'name') throw new Error(`${where}: var ${k} is reserved`);
            if (typeof v !== 'string' || !VALUE.test(v)) throw new Error(`${where}: var ${k} must be a plain token of [A-Za-z0-9._~-]`);
            vars[k] = v;
        }
        const previews = h.previews ?? [];
        if (!Array.isArray(previews) || previews.some((u) => typeof u !== 'string' || !/^https:\/\/\S+$/.test(u))) throw new Error(`${where}: previews must be https URLs`);
        const name = h.name ?? h.host;
        const recipe = { id, version: template.version + revision, ...(fill(template.recipe, vars, where) as object) } as Recipe;
        const metaVars = { ...vars, name };
        const meta = {
            title: fill(template.meta?.title ?? '{{name}}', metaVars, where) as string,
            description: fill(template.meta?.description ?? '', metaVars, where) as string,
            previews,
            family: template.template,
            position: i,
        };
        return { id, recipe, meta, dir };
    });
}

function fill(value: unknown, vars: Record<string, string>, where: string): unknown {
    if (typeof value === 'string') {
        return value.replace(PLACEHOLDER, (_m, k: string) => {
            if (!(k in vars)) throw new Error(`${where}: unknown placeholder {{${k}}}`);
            return vars[k];
        });
    }
    if (Array.isArray(value)) return value.map((v) => fill(v, vars, where));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars, where)]));
    return value;
}

/** Every `<root>/<name>/template.json` with its `hosts.json`, expanded. Ids must be unique across templates. */
export function expandTemplateDirs(root: string): ExpandedRecipe[] {
    const out: ExpandedRecipe[] = [];
    const ids = new Set<string>();
    const names = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, 'template.json')))
        .map((d) => d.name)
        .sort();
    for (const name of names) {
        const dir = path.join(root, name);
        const template = JSON.parse(readFileSync(path.join(dir, 'template.json'), 'utf8')) as RecipeTemplate;
        const hosts = JSON.parse(readFileSync(path.join(dir, 'hosts.json'), 'utf8')) as TemplateHost[];
        if (!Array.isArray(hosts)) throw new Error(`${dir}/hosts.json must be an array`);
        for (const e of expandRecipeTemplate(template, hosts, dir)) {
            if (ids.has(e.id.toLowerCase())) throw new Error(`recipe id ${e.id} comes from two templates`);
            ids.add(e.id.toLowerCase());
            out.push(e);
        }
    }
    return out;
}

/** Writes each expanded recipe as `<out>/<id>/recipe.json`, `meta.json` and its fixtures: the layout of `recipes/`. */
export function writeExpanded(list: ExpandedRecipe[], out: string): void {
    for (const e of list) {
        if (!ID.test(e.id)) throw new Error(`recipe id ${e.id} is not a plain directory name`);
        const target = path.join(out, e.id);
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, 'recipe.json'), JSON.stringify(e.recipe, null, 2) + '\n');
        writeFileSync(path.join(target, 'meta.json'), JSON.stringify(e.meta, null, 2) + '\n');
        for (const f of e.recipe.fixtures ?? []) {
            // Real paths, so neither `..` nor a symlink can reach outside the template folder.
            const from = realpathSync(path.resolve(e.dir, f));
            if (!from.startsWith(realpathSync(e.dir) + path.sep)) throw new Error(`recipe ${e.id}: fixture ${f} is outside its template folder`);
            const to = path.resolve(target, f);
            if (!to.startsWith(path.resolve(target) + path.sep)) throw new Error(`recipe ${e.id}: fixture ${f} is outside its template folder`);
            mkdirSync(path.dirname(to), { recursive: true });
            copyFileSync(from, to);
        }
    }
}
