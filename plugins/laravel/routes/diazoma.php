<?php

use Illuminate\Support\Facades\Route;
use Diazoma\Laravel\Http\Controllers\EmbedController;
use Diazoma\Laravel\Http\Controllers\FeedController;
use Diazoma\Laravel\Http\Controllers\ManifestController;

$prefix = trim((string) config('diazoma.route_prefix'), '/');
$gate = (array) config('diazoma.middleware', []);

Route::get('/.well-known/wall.json', ManifestController::class)->name('diazoma.manifest');

Route::middleware($gate)->group(function () use ($prefix) {
    Route::get($prefix.'/feed/{feed}', FeedController::class)->name('diazoma.feed');

    if (config('diazoma.embed.enabled')) {
        Route::get(config('diazoma.embed.route', '/xr'), EmbedController::class)->name('diazoma.embed');
    }
});
