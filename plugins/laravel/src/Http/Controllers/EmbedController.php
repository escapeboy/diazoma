<?php

namespace Diazoma\Laravel\Http\Controllers;

use Illuminate\Contracts\View\View;

final class EmbedController
{
    public const HOSTED_BASE_URL = 'https://diazoma.app/wall/0.1.0';

    public function __invoke(): View
    {
        $script = (string) config('diazoma.embed.script_url');
        $base = rtrim((string) config('diazoma.embed.base_url'), '/');

        if ($base === '') {
            // Without a base_url the core and loader sit next to the bundle, as diazoma-embed.js assumes
            // (a root-relative script_url such as /e.js gives the site root). With neither set, use the hosted
            // files of the wall version this package was tested with.
            $base = $script !== '' ? preg_replace('#/[^/]*$#', '', $script) : self::HOSTED_BASE_URL;
        }

        // The wall speaks en and bg; any other locale is left out so the wall keeps its default.
        $locale = strtolower(substr((string) (config('diazoma.embed.locale') ?: app()->getLocale()), 0, 2));

        return view(config('diazoma.embed.view', 'diazoma::embed'), [
            'name' => config('diazoma.manifest.name'),
            'scriptUrl' => $script ?: $base . '/diazoma-embed.js',
            'coreUrl' => $base . '/wall.iife.js',
            'manifest' => '/.well-known/wall.json',
            'route' => config('diazoma.embed.route', '/xr'),
            'locale' => in_array($locale, ['en', 'bg'], true) ? $locale : null,
        ]);
    }
}
