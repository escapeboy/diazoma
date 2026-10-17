<?php

use Opis\JsonSchema\Validator;
use Diazoma\Laravel\Tests\Fixtures\IntPost;

/**
 * Validates against the real schemas, resolving $ref by $id: packages/spec/schemas in the monorepo, or the copy in
 * tests/spec-schemas that scripts/open-sync.mjs puts into the split repo escapeboy/diazoma-laravel.
 */
function specValidator(): Validator
{
    $dir = dirname(__DIR__, 4) . '/packages/spec/schemas';
    if (! is_dir($dir)) {
        $dir = dirname(__DIR__) . '/spec-schemas';
    }
    $validator = new Validator();

    foreach (['feed', 'item', 'manifest', 'recipe', 'view'] as $name) {
        $validator->resolver()->registerFile("https://diazoma.app/spec/v1/$name.schema.json", "$dir/$name.schema.json");
    }

    return $validator;
}

it('validates a feed page against the spec schema', function () {
    IntPost::create(['title' => 'One', 'created_at' => now()]);

    $page = json_decode($this->getJson('/wall/feed/int')->getContent());
    $result = specValidator()->validate($page, 'https://diazoma.app/spec/v1/feed.schema.json');

    expect($result->isValid())->toBeTrue();
});

it('validates the manifest against the spec schema', function () {
    $manifest = json_decode($this->getJson('/.well-known/wall.json')->getContent());
    $result = specValidator()->validate($manifest, 'https://diazoma.app/spec/v1/manifest.schema.json');

    expect($result->isValid())->toBeTrue();
});

it('validates a manifest that carries a configured view', function () {
    config()->set('diazoma.manifest.view', [
        'actions' => ['cart' => ['label' => 'Add to cart', 'placement' => 'primary']],
        'wall' => ['rows' => 4, 'indicator' => null],
        'theme' => ['colors' => ['accent' => '#c9334f', 'panel' => 'rgba(8, 8, 11, 0.85)']],
    ]);

    $manifest = json_decode($this->getJson('/.well-known/wall.json')->getContent());
    $result = specValidator()->validate($manifest, 'https://diazoma.app/spec/v1/manifest.schema.json');

    expect($result->isValid())->toBeTrue()
        ->and($manifest->view->wall->rows)->toBe(4);
});

it('rejects a configured view outside the limits', function () {
    config()->set('diazoma.manifest.view', ['wall' => ['rows' => 9]]);

    $manifest = json_decode($this->getJson('/.well-known/wall.json')->getContent());

    expect(specValidator()->validate($manifest, 'https://diazoma.app/spec/v1/manifest.schema.json')->isValid())->toBeFalse();
});

it('rejects a bad item, so the validator is really running', function () {
    $page = json_decode('{"items":[{"id":"1","link":"/a","image":"https://x/y.jpg","aspect":0}]}');

    expect(specValidator()->validate($page, 'https://diazoma.app/spec/v1/feed.schema.json')->isValid())->toBeFalse();
});

it('accepts a feed of text cards and mixed cards, and rejects an item with neither image nor title', function () {
    $v = specValidator();
    $feed = 'https://diazoma.app/spec/v1/feed.schema.json';

    $cards = [
        (new \Diazoma\Laravel\Support\WallItem(id: '1', link: '/a/1', title: 'Act', excerpt: 'Text', date: '2026-10-10', accent: '#123'))->toArray(),
        (new \Diazoma\Laravel\Support\WallItem(id: '2', link: '/a/2', image: 'https://x/2.jpg', aspect: 1.5, title: 'Photo'))->toArray(),
    ];
    $page = json_decode(json_encode(['items' => $cards]));
    expect($v->validate($page, $feed)->isValid())->toBeTrue();

    $bad = json_decode('{"items":[{"id":"1","link":"/a","excerpt":"x"}]}');
    expect($v->validate($bad, $feed)->isValid())->toBeFalse();
});

it('validates video items, YouTube embeds and renditions against the spec schema', function () {
    $items = [
        new \Diazoma\Laravel\Support\WallItem(id: '1', link: '/v/1', image: 'https://x/1.jpg', aspect: 1.78, video: 'https://x/1.m3u8', duration: 61.5),
        new \Diazoma\Laravel\Support\WallItem(id: '2', link: '/v/2', image: 'https://x/2.jpg', aspect: 1.78, videoSources: [['src' => '/2-480.mp4', 'height' => 480, 'bitrate' => 800000, 'codecs' => 'avc1.640028'], ['src' => '/2-1080.mp4', 'type' => 'file', 'height' => 1080]]),
        new \Diazoma\Laravel\Support\WallItem(id: '3', link: '/v/3', video: 'https://youtu.be/dQw4w9WgXcQ'),
        new \Diazoma\Laravel\Support\WallItem(id: '4', link: '/v/4', title: 'Vimeo', video: 'https://vimeo.com/76979871/abcdef1234'),
    ];
    $page = json_decode(json_encode(['items' => array_map(fn ($i) => $i->toArray(), $items)]));

    $result = specValidator()->validate($page, 'https://diazoma.app/spec/v1/feed.schema.json');

    expect($result->isValid())->toBeTrue()
        ->and($page->items[0]->media_type)->toBe('video')
        ->and($page->items[2]->unplayable->embed)->toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
});
