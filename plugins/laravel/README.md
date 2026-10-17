# diazoma/laravel

Serve a [Diazoma](../../README.md) wall from a Laravel 12 or 13 app: a cursor feed, the `/.well-known/wall.json` manifest and an optional `/xr` embed page. PHP 8.4+. Apache-2.0.

## Install

```
composer require diazoma/laravel
php artisan vendor:publish --tag=diazoma-config
```

The service provider is auto-discovered. Routes are only registered when `diazoma.enabled` is true.

## Make a feed

Implement `Diazoma\Laravel\Contracts\WallFeed`, or use the trait for an Eloquent model:

```php
use Diazoma\Laravel\Concerns\ProducesWallFeed;
use Diazoma\Laravel\Contracts\WallFeed;

class ListingFeed implements WallFeed
{
    use ProducesWallFeed;

    protected function wallQuery(): Builder { return Listing::query()->where('published', true); }
    protected function wallSort(): array { return ['created_at' => 'desc']; }
    protected function wallItem(Model $m): WallItem
    {
        return new WallItem(id: (string) $m->getKey(), link: "/listing/{$m->getKey()}", image: $m->thumb_url, aspect: 1.5, title: $m->title);
    }
    protected function wallSearchColumns(): array { return ['title']; }          // optional, enables ?q=
    protected function wallFilters(): array { return ['type' => 'kind']; }       // optional, ?type=video
}
```

Register it in `config/diazoma.php`:

```php
'feeds' => ['latest' => ['class' => ListingFeed::class, 'title' => 'Latest', 'search' => true]],
```

The feed is served at `GET /wall/feed/latest?cursor=&q=&limit=` (prefix from `route_prefix`). Paging is keyset-based over the sort columns plus the primary key, so UUID and integer keys both work and shared sort values are not repeated or skipped. A malformed cursor, or one with a value no row could hold (a date such as `2024-13-45`, a year before 1800, a number too big, a string over 255 characters), returns the first page instead of an error. If your app decodes cursors itself, validate the values the same way: a cursor value goes into SQL, and the database answers an impossible date or number with an error, which the visitor sees as HTTP 500.

### Text cards

An item without an `image` is a text card: the wall draws it from `title`, `subtitle`, the first badge, `excerpt` and `date`. Use it for lists with no pictures (laws, council decisions, news). A text card needs a `title`; `image` and `aspect` are given together or not at all.

```php
new WallItem(
    id: (string) $act->getKey(),
    link: "/act/{$act->ref}",
    title: $act->title,
    subtitle: $act->issuer,            // for example the issuing body
    badges: [$act->type],              // the first badge is the kicker on the card
    excerpt: $act->summary,            // plain text; cut to 500 characters
    date: $act->published_at,          // DateTimeInterface or an ISO 8601 string
    accent: '#7a1f2b',                 // optional #rgb / #rrggbb colour of the top band
);
```

Text cards and image cards can be mixed in one feed.

### Video (0.3.0)

Give `video` (an mp4/webm file, a `.m3u8` HLS playlist or a `.mpd` DASH manifest) and the item becomes a video card: `media_type` is `video` and `video_type` is read from the path. Optional named arguments: `mediaType` (`photo`, `gif`, `video`), `videoType` (`file`, `hls`, `dash`), `videoSources` (up to 8 renditions), `duration` (seconds), `unplayable`.

```php
new WallItem(
    id: (string) $clip->getKey(),
    link: "/clip/{$clip->getKey()}",
    image: $clip->poster_url,
    aspect: 16 / 9,
    video: $clip->hls_url,             // the default source
    videoSources: [                    // optional: alternative renditions, the first is used when video is null
        ['src' => $clip->mp4_480, 'height' => 480],
        ['src' => $clip->mp4_1080, 'height' => 1080, 'codecs' => 'avc1.640028', 'bitrate' => 5000000],
    ],
    duration: $clip->seconds,
);
```

A YouTube or Vimeo URL in `video` (or in `link`, when the item has neither `video` nor `mediaType`) is turned into `media_type: video` plus `unplayable: {provider, embed}` with the canonical embed URL. A YouTube item with no `image` gets YouTube's thumbnail. Hosts are matched exactly, so `youtube.com.evil.example` is left alone. The rules are in `Diazoma\Laravel\Support\VideoUrl`.

Invalid video input is dropped, not thrown: a `video` or source `src` that is not an http(s) URL or a relative reference, sources beyond the 8th, a negative `duration`, an `unplayable.embed` off the allowlist (`www.youtube-nocookie.com/embed/<id>`, `www.youtube.com/embed/<id>`, `player.vimeo.com/video/<id>`). An unknown `mediaType` or an `unplayable` without a `provider` throws `InvalidArgumentException`.

Sort columns must be plain model columns and must not be NULL (a NULL cannot be carried in the cursor).

## Manifest and embed

`/.well-known/wall.json` is built from `diazoma.manifest` and the `feeds` list. It is not behind `diazoma.middleware`, so surfaces can discover the site. Feed and embed routes run through `diazoma.middleware` (for example your age gate).

Set `diazoma.manifest.view` to change how the wall looks for your site (action buttons, info panel, rows, colours, texts). It is copied into the manifest as it is; the shape and the limits are in the spec's `view.schema.json`, and a value outside them is clamped by the wall and reported by the validator. An empty `view` is left out of the manifest.

Set `diazoma.embed.enabled`, and optionally `DIAZOMA_BASE_URL` (empty uses the hosted files at `https://diazoma.app/wall/0.1.0`; otherwise the directory holding `diazoma-embed.js`, `wall.iife.js` and `loader.js`, plus `wall-hls.js` and `wall-dash.js` for HLS/DASH video; without those two, such videos offer "watch in the browser" and mp4 still plays) to serve the Level 3 page at `/xr`. To advertise a wall the host serves itself, leave `embed.enabled` off and set `embed.advertise` to true: the manifest then carries `embed.route` without the package registering the route. The embed script gets `data-locale` from `embed.locale` (`en` or `bg`, env `DIAZOMA_EMBED_LOCALE`); when that is null the app locale is used if the wall supports it, so a Bulgarian app (`bg`) gets a Bulgarian wall. Override the Blade view with the `embed.view` setting or `vendor/diazoma`.

## Device link

`Diazoma\Laravel\Contracts\DeviceLink` is an interface only. There is no implementation and no route. Its docblock lists the security rules an implementation must keep.

## Tests

```
composer install
composer test
composer lint
```

The suite runs on Laravel 12 (`orchestra/testbench` ^10) and Laravel 13 (`^11`). To try one locally:

```
composer update -W laravel/framework:^12.0 orchestra/testbench:^10.0
composer update -W laravel/framework:^13.0 orchestra/testbench:^11.0
```

Feed and manifest are validated against `packages/spec/schemas/*.json` when those files exist; until then those two tests skip.
