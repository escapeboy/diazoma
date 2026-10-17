<?php

use Diazoma\Laravel\Tests\Fixtures\DenyAll;

it('runs the configured middleware on feed and embed but not on the manifest', function () {
    $this->getJson('/wall/feed/int')->assertStatus(451);
    $this->get('/xr')->assertStatus(451);
    $this->getJson('/.well-known/wall.json')->assertOk();
});

it('advertises the embed route in the manifest when enabled', function () {
    $this->getJson('/.well-known/wall.json')->assertJsonPath('embed.route', '/xr');
});

it('renders the embed script tag with manifest and route', function () {
    $this->withoutMiddleware(DenyAll::class)
        ->get('/xr')
        ->assertOk()
        ->assertSee('<script src="https://cdn.example.com/diazoma/diazoma-embed.js" data-manifest="/.well-known/wall.json" data-route="/xr" data-core="https://cdn.example.com/diazoma/wall.iife.js" data-locale="en"></script>', false);
});

it('lets script_url override the embed bundle only', function () {
    config()->set('diazoma.embed.script_url', 'https://other.example.com/e.js');

    $this->withoutMiddleware(\Diazoma\Laravel\Tests\Fixtures\DenyAll::class)
        ->get('/xr')
        ->assertSee('src="https://other.example.com/e.js"', false)
        ->assertSee('data-core="https://cdn.example.com/diazoma/wall.iife.js"', false);
});

it('derives the core url from the directory of script_url when base_url is empty', function () {
    config()->set('diazoma.embed.base_url', null);
    config()->set('diazoma.embed.script_url', 'https://other.example.com/assets/e.js');

    $this->withoutMiddleware(\Diazoma\Laravel\Tests\Fixtures\DenyAll::class)
        ->get('/xr')
        ->assertSee('src="https://other.example.com/assets/e.js"', false)
        ->assertSee('data-core="https://other.example.com/assets/wall.iife.js"', false);
});

it('sends data-locale from embed.locale, and from the app locale when the wall supports it', function () {
    $gate = \Diazoma\Laravel\Tests\Fixtures\DenyAll::class;

    config()->set('diazoma.embed.locale', 'bg');
    $this->withoutMiddleware($gate)->get('/xr')->assertSee('data-locale="bg"', false);

    config()->set('diazoma.embed.locale', null);
    app()->setLocale('bg_BG');
    $this->withoutMiddleware($gate)->get('/xr')->assertSee('data-locale="bg"', false);

    app()->setLocale('fr');
    $this->withoutMiddleware($gate)->get('/xr')->assertDontSee('data-locale', false);

    config()->set('diazoma.embed.locale', 'de');
    $this->withoutMiddleware($gate)->get('/xr')->assertDontSee('data-locale', false);
});

it('uses the hosted files on diazoma.app when neither base_url nor script_url is set', function () {
    config()->set('diazoma.embed.base_url', null);
    config()->set('diazoma.embed.script_url', null);

    $this->withoutMiddleware(\Diazoma\Laravel\Tests\Fixtures\DenyAll::class)
        ->get('/xr')
        ->assertSee('src="https://diazoma.app/wall/0.1.0/diazoma-embed.js"', false)
        ->assertSee('data-core="https://diazoma.app/wall/0.1.0/wall.iife.js"', false);
});

it('keeps a root-relative script_url next to its own core', function () {
    config()->set('diazoma.embed.base_url', null);
    config()->set('diazoma.embed.script_url', '/e.js');

    $this->withoutMiddleware(\Diazoma\Laravel\Tests\Fixtures\DenyAll::class)
        ->get('/xr')
        ->assertSee('src="/e.js"', false)
        ->assertSee('data-core="/wall.iife.js"', false)
        ->assertDontSee('diazoma.app/wall', false);
});
