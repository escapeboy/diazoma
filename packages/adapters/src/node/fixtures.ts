import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseHTML } from 'linkedom';
import { RecipeAdapter, type Recipe } from '../RecipeAdapter.js';
import { installDom } from './dom.js';

const require = createRequire(import.meta.url);

export interface FixtureResult {
    fixture: string;
    ok: boolean;
    items: number;
    problems: string[];
}

export interface FixturesReport {
    recipe: string;
    ok: boolean;
    schemaErrors: string[];
    results: FixtureResult[];
}

const CORE = ['id', 'link', 'image', 'aspect'] as const;

let validator: ReturnType<Ajv2020['compile']> | null = null;

/** Checks a recipe against `@diazoma/recipe-schema`. Returns the problems, empty when valid. */
export function validateRecipe(recipe: unknown): string[] {
    if (!validator) {
        const schema = JSON.parse(readFileSync(require.resolve('@diazoma/recipe-schema/recipe.schema.json'), 'utf8'));
        const view = JSON.parse(readFileSync(require.resolve('@diazoma/recipe-schema/view.schema.json'), 'utf8'));
        const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
        ajv.addSchema(view);
        validator = ajv.compile(schema);
    }
    return validator(recipe) ? [] : (validator.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

/**
 * Replays every fixture of a recipe through RecipeAdapter with a fixture-backed fetch and asserts at
 * least one item with all four core fields. `.json` fixtures run the api source, `.html` the dom source.
 */
export async function runFixtures(recipe: Recipe, dir: string): Promise<FixturesReport> {
    installDom();
    const schemaErrors = validateRecipe(recipe);
    const results: FixtureResult[] = [];
    const base = recipeBase(recipe);
    if (!recipe.fixtures?.length) schemaErrors.push('/fixtures recipe ships no fixtures');
    for (const fixture of recipe.fixtures ?? []) {
        const problems: string[] = [];
        let items = 0;
        try {
            const content = readFileSync(path.resolve(dir, fixture), 'utf8');
            const isJson = fixture.endsWith('.json');
            const fetchFn = async () => new Response(content, { status: 200, headers: { 'Content-Type': isJson ? 'application/json' : 'text/html' } });
            const opts = isJson
                ? { recipe, fetch: fetchFn, url: base, source: 'api' as const }
                : { recipe, fetch: fetchFn, url: base, source: 'dom' as const, document: parseHTML(content).document as unknown as Document };
            const page = await new RecipeAdapter(opts).page({});
            items = page.items.length;
            if (!items) problems.push('no items');
            page.items.forEach((item, i) => {
                for (const k of CORE) {
                    if (item[k] !== undefined && item[k] !== '') continue;
                    // The wall accepts a text card, but a recipe describes a picture site: image and aspect stay required here.
                    problems.push(k === 'image' || k === 'aspect' ? `item ${i} lacks ${k}: a recipe item needs an image and its aspect (a text-only item is not accepted from a recipe)` : `item ${i} lacks ${k}`);
                }
            });
        } catch (e) {
            problems.push((e as Error).message);
        }
        results.push({ fixture, ok: problems.length === 0, items, problems });
    }
    return { recipe: `${recipe.id}@${recipe.version}`, ok: !schemaErrors.length && results.every((r) => r.ok), schemaErrors, results };
}

function recipeBase(recipe: Recipe): string {
    const m = recipe.match[0] ?? 'https://invalid.example/*';
    return m.replace(/^\*:/, 'https:').replace('//*.', '//').replace(/\*.*$/, '').replace(/\/?$/, '/');
}
