<?php

return [
    'enabled' => env('DIAZOMA_ENABLED', true),

    'route_prefix' => env('DIAZOMA_ROUTE_PREFIX', 'wall'),

    // Applied to the feed and embed routes (e.g. the host's age gate). The
    // manifest stays ungated so surfaces can discover the site.
    'middleware' => [],

    // id => ['class' => WallFeed implementation, 'title' => string, 'search' => bool]
    'feeds' => [],

    'manifest' => [
        'name' => env('DIAZOMA_NAME', env('APP_NAME', 'Laravel')),
        'policy' => env('DIAZOMA_POLICY', 'allow'),
        'brand' => [
            'accent' => env('DIAZOMA_BRAND_ACCENT'),
            'logo' => env('DIAZOMA_BRAND_LOGO'),
            'bg' => env('DIAZOMA_BRAND_BG'),
        ],
        'filters' => [],
        'media' => [
            'hosts' => [],
            'variants' => [],
            'projections' => [],
        ],
        'actions' => [],
        'auth' => [
            'login' => null,
            'device_link' => null,
        ],
        'recipe' => null,
        // How the wall looks for this site: action buttons, info panel, layout, colours, texts.
        // Passed to the manifest as is. Shape and limits: packages/spec/schemas/view.schema.json.
        // 'view' => [
        //     'actions' => ['cart' => ['label' => 'Add to cart', 'placement' => 'primary']],
        //     'panel' => ['fields' => ['title', 'meta.price', 'description']],
        //     'wall' => ['rows' => 4, 'card' => ['width' => 0.3, 'height' => 0.3]],
        //     'theme' => ['colors' => ['accent' => '#c9334f']],
        // ],
        'view' => [],
    ],

    'embed' => [
        'enabled' => env('DIAZOMA_EMBED', false),
        'route' => '/xr',
        // Put embed.route in the manifest. null follows `enabled`; set true when the
        // host serves its own wall at `route` and the package does not register it.
        'advertise' => env('DIAZOMA_EMBED_ADVERTISE'),
        // Directory holding diazoma-embed.js, wall.iife.js and loader.js, plus wall-hls.js and
        // wall-dash.js for HLS/DASH video (without them such videos offer "watch in the
        // browser"; mp4 still plays). When empty and
        // script_url is set, the directory of script_url is used; when both are empty, the hosted
        // files at https://diazoma.app/wall/0.1.0 are used.
        'base_url' => env('DIAZOMA_BASE_URL'),
        // Optional full URL overriding <base_url>/diazoma-embed.js.
        'script_url' => env('DIAZOMA_SCRIPT_URL'),
        // `data-locale` of the embed script: 'en' or 'bg'. null uses the app locale when the wall
        // supports it, and sends nothing otherwise.
        'locale' => env('DIAZOMA_EMBED_LOCALE'),
        'view' => 'diazoma::embed',
    ],

    'per_page' => 50,
    'max_per_page' => 100,
];
