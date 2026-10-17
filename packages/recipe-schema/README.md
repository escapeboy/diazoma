# @diazoma/recipe-schema

The JSON Schema (draft 2020-12) for Diazoma recipes. A recipe is a small JSON file that tells
`RecipeAdapter` (in `@diazoma/adapters`) how to read a site that does not publish the
site-compatibility spec: a CSS-selector source for the page, or a JSONPath source for a JSON API.

This package is the schema file only. The canonical copy is `recipe.schema.json`; `@diazoma/spec`
re-exports it and a test checks the two are identical.

```js
import schema from '@diazoma/recipe-schema' with { type: 'json' };
```

Rules a recipe follows: no code; no regex on HTML (a regex runs only on a string that was already
extracted, through `re` and `group`); `match` uses Chrome match patterns and a recipe never applies
outside them; every recipe ships fixtures.

Licence: Apache-2.0.
