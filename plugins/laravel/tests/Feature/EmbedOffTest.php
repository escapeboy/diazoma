<?php

it('has no embed route and no embed entry when disabled', function () {
    $this->get('/xr')->assertNotFound();
    $this->getJson('/.well-known/wall.json')->assertJsonMissingPath('embed');
});

it('advertises embed.route without registering it when advertise is true', function () {
    $manifest = (new Diazoma\Laravel\Support\ManifestBuilder(array_replace_recursive(config('diazoma'), [
        'embed' => ['enabled' => false, 'advertise' => true, 'route' => '/my-wall'],
    ])))->build();

    expect($manifest['embed'])->toBe(['route' => '/my-wall']);
    $this->get('/my-wall')->assertNotFound();
});

it('does not advertise when enabled but advertise is false', function () {
    $manifest = (new Diazoma\Laravel\Support\ManifestBuilder(array_replace_recursive(config('diazoma'), [
        'embed' => ['enabled' => true, 'advertise' => false],
    ])))->build();

    expect($manifest)->not->toHaveKey('embed');
});
