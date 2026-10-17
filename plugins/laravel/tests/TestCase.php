<?php

namespace Diazoma\Laravel\Tests;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Orchestra\Testbench\TestCase as Orchestra;
use Diazoma\Laravel\DiazomaServiceProvider;
use Diazoma\Laravel\Tests\Fixtures\IntPostFeed;
use Diazoma\Laravel\Tests\Fixtures\UuidPostFeed;

abstract class TestCase extends Orchestra
{
    protected function getPackageProviders($app): array
    {
        return [DiazomaServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set('database.default', 'testing');
        $app['config']->set('database.connections.testing', [
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
        ]);
        $app['config']->set('diazoma.feeds', [
            'uuid' => ['class' => UuidPostFeed::class, 'title' => 'Uuid posts', 'search' => true],
            'int' => ['class' => IntPostFeed::class, 'title' => 'Int posts'],
        ]);
        $app['config']->set('diazoma.manifest.name', 'Test site');
        $app['config']->set('diazoma.manifest.brand.accent', '#c9334f');
        $app['config']->set('diazoma.max_per_page', 100);
    }

    protected function setUp(): void
    {
        parent::setUp();

        Schema::create('uuid_posts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('title');
            $table->string('kind')->default('photo');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('int_posts', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->string('kind')->default('photo');
            $table->timestamp('created_at')->nullable();
        });
    }
}
