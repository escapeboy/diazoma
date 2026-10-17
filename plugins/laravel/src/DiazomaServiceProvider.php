<?php

namespace Diazoma\Laravel;

use Illuminate\Support\ServiceProvider;

class DiazomaServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/diazoma.php', 'diazoma');
    }

    public function boot(): void
    {
        $this->loadViewsFrom(__DIR__.'/../resources/views', 'diazoma');

        $this->publishes([
            __DIR__.'/../config/diazoma.php' => config_path('diazoma.php'),
        ], 'diazoma-config');

        if (config('diazoma.enabled')) {
            $this->loadRoutesFrom(__DIR__.'/../routes/diazoma.php');
        }
    }
}
