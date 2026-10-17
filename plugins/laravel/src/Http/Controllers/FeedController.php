<?php

namespace Diazoma\Laravel\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Diazoma\Laravel\Contracts\WallFeed;
use Diazoma\Laravel\Support\WallRequest;

final class FeedController
{
    public function __invoke(Request $request, string $feed): JsonResponse
    {
        $definition = config("diazoma.feeds.$feed");
        abort_unless(is_array($definition), 404);

        $source = app($definition['class']);
        abort_unless($source instanceof WallFeed, 500, 'Wall feed must implement '.WallFeed::class);

        $max = (int) config('diazoma.max_per_page', 100);
        $limit = (int) $request->query('limit', config('diazoma.per_page', 50));
        $limit = min(max($limit, 1), $max);

        $query = $request->query('q');
        $reserved = ['cursor', 'q', 'limit'];
        $filters = array_filter(
            $request->query(),
            fn ($value, $name) => is_string($value) && ! in_array($name, $reserved, true),
            ARRAY_FILTER_USE_BOTH,
        );

        $page = $source->wallPage(new WallRequest(
            cursor: is_string($request->query('cursor')) ? $request->query('cursor') : null,
            query: ($definition['search'] ?? false) && is_string($query) ? $query : null,
            filters: $filters,
            limit: $limit,
        ));

        return response()->json($page->toArray());
    }
}
