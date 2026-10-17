import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runFixtures, validateRecipe } from '../src/node/fixtures';
import { FIXTURES } from './helpers';
import type { Recipe } from '../src/RecipeAdapter';

const dir = path.join(FIXTURES, 'recipes');
const load = (f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Recipe;

describe('runFixtures', () => {
    it('replays the dom sample recipe: >= 1 item with all core fields', async () => {
        const r = await runFixtures(load('botanical-dom.json'), dir);
        expect(r).toMatchObject({ ok: true, schemaErrors: [], results: [{ fixture: 'botanical-dom/listing.html', ok: true, items: 3 }] });
    });
    it('replays the api sample recipe', async () => {
        const r = await runFixtures(load('botanical-api.json'), dir);
        expect(r).toMatchObject({ ok: true, results: [{ fixture: 'botanical-api/page1.json', ok: true, items: 3 }] });
    });
    it('fails a recipe whose selectors match nothing', async () => {
        const recipe = load('botanical-dom.json');
        recipe.list!.item = 'li.gone';
        const r = await runFixtures(recipe, dir);
        expect(r.ok).toBe(false);
        expect(r.results[0].problems).toContain('no items');
    });
    it('fails a recipe without fixtures and one that breaks the schema', async () => {
        const recipe = load('botanical-dom.json');
        delete recipe.fixtures;
        expect((await runFixtures(recipe, dir)).ok).toBe(false);
        expect(validateRecipe({ id: 'x' })).not.toEqual([]);
    });
    it('validates a recipe view against view.schema.json', () => {
        const recipe = load('botanical-dom.json');
        expect(validateRecipe({ ...recipe, view: { wall: { rows: 4 } } })).toEqual([]);
        expect(validateRecipe({ ...recipe, view: { wall: { rows: 9 } } }).join()).toContain('/view/wall/rows');
    });
    it('says what a recipe item needs when it has no image: recipes stay picture-based', async () => {
        const recipe = load('botanical-api.json');
        delete recipe.api!.fields!.image;
        delete recipe.api!.fields!.aspect;
        const r = await runFixtures(recipe, dir);
        expect(r.ok).toBe(false);
        expect(r.results[0].problems[0]).toBe('item 0 lacks image: a recipe item needs an image and its aspect (a text-only item is not accepted from a recipe)');
    });
    it('reports a missing fixture file instead of throwing', async () => {
        const recipe = load('botanical-dom.json');
        recipe.fixtures = ['nope.html'];
        const r = await runFixtures(recipe, dir);
        expect(r.ok).toBe(false);
        expect(r.results[0].problems[0]).toMatch(/ENOENT/);
    });
});
