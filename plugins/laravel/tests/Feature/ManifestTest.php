<?php

use Illuminate\Support\Arr;
use Diazoma\Laravel\Support\ManifestBuilder;

it('serves a manifest with the 02 example structure', function () {
    config()->set('diazoma.manifest', array_replace_recursive(config('diazoma.manifest'), [
        'filters' => [['id' => 'type', 'title' => 'Type', 'values' => ['all', 'photo', 'video'], 'param' => 'type']],
        'media' => ['hosts' => ['cdn.example.com'], 'variants' => ['thumb' => 512, 'focus' => 1024, 'full' => 2560], 'projections' => ['flat']],
        'actions' => ['like' => ['method' => 'POST', 'url' => '/api/items/{id}/like', 'auth' => 'session', 'toggle' => true]],
        'auth' => ['login' => '/login', 'device_link' => '/wall/link'],
        'recipe' => '/.well-known/wall-recipe.json',
    ]));

    $res = $this->getJson('/.well-known/wall.json')->assertOk();
    $m = $res->json();

    expect($m['version'])->toBe(1)
        ->and($m['policy'])->toBe('allow')
        ->and($m['name'])->toBe('Test site')
        ->and($m['brand'])->toBe(['accent' => '#c9334f'])
        ->and($m['filters'][0]['param'])->toBe('type')
        ->and($m['media']['hosts'])->toBe(['cdn.example.com'])
        ->and($m['actions']['like']['auth'])->toBe('session')
        ->and($m['auth'])->toBe(['login' => '/login', 'device_link' => '/wall/link'])
        ->and($m['recipe'])->toBe('/.well-known/wall-recipe.json')
        ->and($m)->not->toHaveKey('embed');

    $res->assertHeader('Access-Control-Allow-Origin', '*');
});

it('maps feeds to urls and adds a search feed where enabled', function () {
    $feeds = $this->getJson('/.well-known/wall.json')->json('feeds');

    expect($feeds)->toBe([
        ['id' => 'uuid', 'title' => 'Uuid posts', 'url' => '/wall/feed/uuid', 'cursor' => true],
        ['id' => 'uuid-search', 'title' => 'Uuid posts', 'type' => 'search', 'url' => '/wall/feed/uuid?q={query}'],
        ['id' => 'int', 'title' => 'Int posts', 'url' => '/wall/feed/int', 'cursor' => true],
    ]);
});

it('passes policy values through', function (string $policy) {
    config()->set('diazoma.manifest.policy', $policy);

    $this->getJson('/.well-known/wall.json')->assertJsonPath('policy', $policy);
})->with(['allow', 'deny', 'recipes-only']);

it('keeps the feed urls in step with route_prefix', function () {
    $builder = new ManifestBuilder(array_replace(config('diazoma'), ['route_prefix' => '/gallery/']));

    expect(Arr::get($builder->build(), 'feeds.0.url'))->toBe('/gallery/feed/uuid');
});

it('copies a configured view into the manifest, keeping nulls, and leaves an empty one out', function () {
    expect($this->getJson('/.well-known/wall.json')->json())->not->toHaveKey('view');

    config()->set('diazoma.manifest.view', ['wall' => ['rows' => 4, 'indicator' => null]]);

    $this->getJson('/.well-known/wall.json')->assertJsonPath('view', ['wall' => ['rows' => 4, 'indicator' => null]]);
});

it('leaves empty objects out of the view and keeps empty lists', function () {
    config()->set('diazoma.manifest.view', ['strings' => [], 'panel' => ['metaLabels' => [], 'side' => []], 'actions' => ['cart' => []]]);

    $this->getJson('/.well-known/wall.json')->assertJsonPath('view', ['panel' => ['side' => []]]);
    expect($this->getJson('/.well-known/wall.json')->getContent())->toContain('"view":{"panel":{"side":[]}}');
});

it('leaves out a view that only had empty objects', function () {
    config()->set('diazoma.manifest.view', ['strings' => [], 'theme' => ['colors' => []]]);

    expect($this->getJson('/.well-known/wall.json')->json())->not->toHaveKey('view');
});
