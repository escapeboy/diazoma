<?php

namespace Diazoma\Laravel\Support;

use DateTimeInterface;
use InvalidArgumentException;

final readonly class WallItem
{
    public const EXCERPT_MAX = 500;

    /** ISO 8601 date, or date-time with an optional offset (the pattern of item.schema.json). */
    private const DATE_PATTERN = '/^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?)?$/';

    /** Plain text, at most 500 characters; longer text is cut with an ellipsis. */
    public ?string $excerpt;

    /** ISO 8601 date or date-time; a DateTimeInterface is formatted. */
    public ?string $date;

    /** #rgb or #rrggbb colour of the text card's top band. */
    public ?string $accent;

    public ?string $image;

    public ?float $aspect;

    public ?string $video;

    /** photo, gif or video. Video when a $video is set and none is given. */
    public ?string $mediaType;

    /** file, hls or dash. Inferred from the $video path when not given. */
    public ?string $videoType;

    /** @var list<array{src: string, type?: string, height?: int, codecs?: string, bitrate?: int}>|null */
    public ?array $videoSources;

    /** Seconds. */
    public int|float|null $duration;

    /** @var array{provider: string, embed?: string}|null */
    public ?array $unplayable;

    /**
     * An item with an $image also needs an $aspect. An item without an image is a text card and needs a $title.
     *
     * A YouTube or Vimeo URL in $video (or in $link, when the item has neither $video nor $mediaType) becomes
     * $mediaType 'video' with $unplayable (provider and canonical embed); a YouTube item without an image gets
     * YouTube's thumbnail. Video fields that are not valid (a non-web URL, more than 8 sources, a negative
     * duration, an embed off the allowlist) are dropped, as the adapters do.
     *
     * @param  list<string>  $badges
     * @param  array<string, scalar>  $meta
     * @param  list<array<string, mixed>>|null  $videoSources  Up to 8 of ['src' => url, 'type' => file|hls|dash, 'height' => int, 'codecs' => string, 'bitrate' => int].
     * @param  array{provider: string, embed?: string}|null  $unplayable
     */
    public function __construct(
        public string $id,
        public string $link,
        ?string $image = null,
        ?float $aspect = null,
        public ?string $title = null,
        public ?string $subtitle = null,
        public ?string $imageFocus = null,
        public ?string $imageFull = null,
        public array $badges = [],
        public ?string $blurhash = null,
        ?string $video = null,
        public ?string $projection = null,
        public ?string $stereo = null,
        public array $meta = [],
        ?string $excerpt = null,
        DateTimeInterface|string|null $date = null,
        ?string $accent = null,
        ?string $mediaType = null,
        ?string $videoType = null,
        ?array $videoSources = null,
        int|float|null $duration = null,
        ?array $unplayable = null,
    ) {
        if ($id === '') {
            throw new InvalidArgumentException('Wall item id must be a non-empty string.');
        }

        if ($mediaType !== null && ! in_array($mediaType, ['photo', 'gif', 'video'], true)) {
            throw new InvalidArgumentException("Wall item mediaType must be photo, gif or video, got [$mediaType].");
        }

        if ($unplayable !== null && (! isset($unplayable['provider']) || ! is_string($unplayable['provider']) || $unplayable['provider'] === '')) {
            throw new InvalidArgumentException('Wall item unplayable needs a provider name.');
        }

        $hosted = $video !== null && $video !== ''
            ? VideoUrl::hosted($video)
            : (($video === null || $video === '') && $mediaType === null ? VideoUrl::hosted($link) : null);
        if ($hosted !== null) {
            $video = null;
            $mediaType = 'video';
            $unplayable = ['provider' => $hosted['provider'], 'embed' => $hosted['embed']] + ($unplayable ?? []);
            if (isset($hosted['poster']) && $image === null) {
                $image = $hosted['poster'];
                $aspect = 16 / 9;
            }
        }

        if (! preg_match('#^(https?://[^\s/]|/(?!/))\S*$#i', $link)) {
            throw new InvalidArgumentException("Wall item link must be absolute or root-relative, got [$link].");
        }

        if ($image === '') {
            throw new InvalidArgumentException('Wall item image must not be empty.');
        }

        if ($image !== null && ($aspect === null || ! is_finite($aspect) || $aspect <= 0)) {
            throw new InvalidArgumentException('Wall item aspect must be greater than zero when the item has an image.');
        }

        if ($image === null && ($title === null || trim($title) === '')) {
            throw new InvalidArgumentException('A wall item without an image is a text card and needs a title.');
        }

        if ($aspect !== null && (! is_finite($aspect) || $aspect <= 0)) {
            throw new InvalidArgumentException('Wall item aspect must be greater than zero.');
        }

        $excerpt = $excerpt === null ? null : trim($excerpt);
        $this->excerpt = $excerpt === null || $excerpt === ''
            ? null
            : (mb_strlen($excerpt) > self::EXCERPT_MAX ? rtrim(mb_substr($excerpt, 0, self::EXCERPT_MAX - 1)).'…' : $excerpt);

        $date = $date instanceof DateTimeInterface ? $date->format(DATE_ATOM) : $date;
        if ($date !== null && ! preg_match(self::DATE_PATTERN, $date)) {
            throw new InvalidArgumentException("Wall item date must be an ISO 8601 date or date-time, got [$date].");
        }
        $this->date = $date;

        if ($accent !== null && ! preg_match('/^#([0-9a-f]{3}|[0-9a-f]{6})$/i', $accent)) {
            throw new InvalidArgumentException("Wall item accent must be #rgb or #rrggbb, got [$accent].");
        }
        $this->accent = $accent;

        $this->image = $image;
        $this->aspect = $aspect;
        $this->initVideo($video, $mediaType, $videoType, $videoSources, $duration, $unplayable);
    }

    /**
     * @param  list<array<string, mixed>>|null  $sources
     * @param  array<string, mixed>|null  $unplayable
     */
    private function initVideo(?string $video, ?string $mediaType, ?string $videoType, ?array $sources, int|float|null $duration, ?array $unplayable): void
    {
        $video = $video !== null && VideoUrl::isWebUrl($video) && $video !== '' ? $video : null;

        $clean = [];
        foreach ($sources ?? [] as $source) {
            if (! is_array($source) || ! isset($source['src']) || ! is_string($source['src']) || $source['src'] === '' || ! VideoUrl::isWebUrl($source['src'])) {
                continue;
            }
            $clean[] = array_filter([
                'src' => $source['src'],
                'type' => in_array($source['type'] ?? null, ['file', 'hls', 'dash'], true) ? $source['type'] : null,
                'height' => is_int($source['height'] ?? null) && $source['height'] > 0 ? $source['height'] : null,
                'codecs' => is_string($source['codecs'] ?? null) && $source['codecs'] !== '' ? $source['codecs'] : null,
                'bitrate' => is_int($source['bitrate'] ?? null) && $source['bitrate'] > 0 ? $source['bitrate'] : null,
            ], fn ($value) => $value !== null);
            if (count($clean) >= VideoUrl::MAX_SOURCES) {
                break;
            }
        }
        $sourceType = null;
        if ($video === null && $clean !== []) {
            $video = $clean[0]['src'];
            $sourceType = $clean[0]['type'] ?? null;
        }

        $this->video = $video;
        $this->videoSources = $clean === [] ? null : $clean;
        $this->videoType = $video === null ? null : (in_array($videoType, ['file', 'hls', 'dash'], true) ? $videoType : ($sourceType ?? VideoUrl::kind($video)));
        $this->mediaType = $mediaType ?? ($video !== null ? 'video' : null);
        $this->duration = is_numeric($duration) && is_finite((float) $duration) && $duration >= 0 ? $duration : null;

        if ($unplayable !== null) {
            $embed = VideoUrl::allowedEmbed($unplayable['embed'] ?? null);
            $unplayable = ['provider' => $unplayable['provider']] + ($embed !== null ? ['embed' => $embed] : []);
        }
        $this->unplayable = $unplayable;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return array_filter([
            'id' => $this->id,
            'link' => $this->link,
            'title' => $this->title,
            'subtitle' => $this->subtitle,
            'image' => $this->image,
            'image_focus' => $this->imageFocus,
            'image_full' => $this->imageFull,
            'aspect' => $this->aspect,
            'badges' => $this->badges,
            'blurhash' => $this->blurhash,
            'video' => $this->video,
            'video_type' => $this->videoType,
            'video_sources' => $this->videoSources,
            'duration' => $this->duration,
            'projection' => $this->projection,
            'stereo' => $this->stereo,
            'media_type' => $this->mediaType,
            'unplayable' => $this->unplayable,
            'meta' => $this->meta,
            'excerpt' => $this->excerpt,
            'date' => $this->date,
            'accent' => $this->accent,
        ], fn ($value) => $value !== null && $value !== []);
    }
}
