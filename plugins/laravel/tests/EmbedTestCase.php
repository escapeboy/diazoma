<?php

namespace Diazoma\Laravel\Tests;

use Diazoma\Laravel\Tests\Fixtures\DenyAll;

/** Embed on, a host middleware (an age-gate stand-in) in front of feed and embed. */
abstract class EmbedTestCase extends TestCase
{
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);

        $app['config']->set('diazoma.embed.enabled', true);
        $app['config']->set('diazoma.embed.base_url', 'https://cdn.example.com/diazoma/');
        $app['config']->set('diazoma.middleware', [DenyAll::class]);
    }
}
