<?php

namespace Diazoma\Laravel\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Diazoma\Laravel\Support\ManifestBuilder;

final class ManifestController
{
    public function __invoke(): JsonResponse
    {
        return response()
            ->json((new ManifestBuilder(config('diazoma')))->build())
            ->header('Access-Control-Allow-Origin', '*')
            ->header('Cache-Control', 'public, max-age=300');
    }
}
