<?php

namespace Diazoma\Laravel\Support;

/**
 * YouTube and Vimeo recognition and the embed allowlist of the Diazoma spec (3.4.1).
 *
 * Hosts are matched exactly, so youtube.com.evil.example and evilyoutube.com are not YouTube.
 */
final class VideoUrl
{
    public const MAX_SOURCES = 8;

    private const YT_ID = '/^[A-Za-z0-9_-]{11}$/D';

    private const VIMEO_ID = '/^\d+$/D';

    private const VIMEO_HASH = '/^[A-Za-z0-9]{1,32}$/D';

    /**
     * @return array{provider: string, embed: string, poster?: string}|null
     */
    public static function hosted(string $url): ?array
    {
        $url = trim($url);
        if (str_contains($url, '\\')) {
            return null;
        }
        $parts = parse_url($url);
        if ($parts === false || ! isset($parts['scheme'], $parts['host']) || ! in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
            return null;
        }

        $host = strtolower($parts['host']);
        $path = self::pathParts($parts['path'] ?? '');
        $vs = self::queryValues($parts['query'] ?? '', 'v');
        $hs = self::queryValues($parts['query'] ?? '', 'h');
        // A repeated v or h is ambiguous, so the URL is not recognised.
        if (count($vs) > 1 || count($hs) > 1) {
            return null;
        }
        $v = $vs[0] ?? null;
        $h = $hs[0] ?? null;

        if ($host === 'youtu.be') {
            return count($path) === 1 && self::isYoutubeId($path[0]) ? self::youtube($path[0]) : null;
        }

        if (in_array($host, ['youtube.com', 'www.youtube.com', 'm.youtube.com'], true)) {
            if (count($path) === 1 && $path[0] === 'watch' && is_string($v) && self::isYoutubeId($v)) {
                return self::youtube($v);
            }
            if ($host !== 'm.youtube.com' && count($path) === 2 && in_array($path[0], ['shorts', 'embed'], true) && self::isYoutubeId($path[1])) {
                return self::youtube($path[1]);
            }

            return null;
        }

        if (in_array($host, ['youtube-nocookie.com', 'www.youtube-nocookie.com'], true)) {
            return count($path) === 2 && $path[0] === 'embed' && self::isYoutubeId($path[1]) ? self::youtube($path[1]) : null;
        }

        if (in_array($host, ['vimeo.com', 'www.vimeo.com'], true)) {
            if (count($path) >= 1 && count($path) <= 2 && preg_match(self::VIMEO_ID, $path[0]) && (count($path) === 1 || preg_match(self::VIMEO_HASH, $path[1]))) {
                return self::vimeo($path[0], $path[1] ?? null);
            }

            return null;
        }

        if ($host === 'player.vimeo.com') {
            return count($path) === 2 && $path[0] === 'video' && preg_match(self::VIMEO_ID, $path[1]) ? self::vimeo($path[1], is_string($h) ? $h : null) : null;
        }

        return null;
    }

    /** The canonical embed URL when $value is on the embed allowlist (https only), else null. */
    public static function allowedEmbed(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $value = trim($value);
        if (str_contains($value, '\\')) {
            return null;
        }
        $parts = parse_url($value);
        if ($parts === false || strtolower($parts['scheme'] ?? '') !== 'https' || ! isset($parts['host'])) {
            return null;
        }

        $host = strtolower($parts['host']);
        $path = self::pathParts($parts['path'] ?? '');
        $hs = self::queryValues($parts['query'] ?? '', 'h');
        if (count($hs) > 1) {
            return null;
        }

        if (in_array($host, ['www.youtube-nocookie.com', 'www.youtube.com'], true) && count($path) === 2 && $path[0] === 'embed' && self::isYoutubeId($path[1])) {
            return self::youtube($path[1])['embed'];
        }
        if ($host === 'player.vimeo.com' && count($path) === 2 && $path[0] === 'video' && preg_match(self::VIMEO_ID, $path[1])) {
            return self::vimeo($path[1], $hs[0] ?? null)['embed'];
        }

        return null;
    }

    /** hls for a path ending .m3u8, dash for .mpd, else file. */
    public static function kind(string $url): string
    {
        $path = strtolower((string) (parse_url($url, PHP_URL_PATH) ?? $url));

        return str_ends_with($path, '.m3u8') ? 'hls' : (str_ends_with($path, '.mpd') ? 'dash' : 'file');
    }

    /** True for an http(s) URL or a reference without a scheme; javascript:, data:, file: and the like are false. */
    public static function isWebUrl(string $value): bool
    {
        if (preg_match('#^https?://#i', $value)) {
            return parse_url($value) !== false;
        }

        return ! preg_match('/^[a-z][a-z0-9+.-]*:/i', preg_replace('/[\x00-\x20]/', '', $value) ?? $value);
    }

    private static function isYoutubeId(string $id): bool
    {
        return (bool) preg_match(self::YT_ID, $id);
    }

    /** @return list<string> */
    private static function queryValues(string $query, string $name): array
    {
        $out = [];
        foreach (explode('&', $query) as $pair) {
            $kv = explode('=', $pair, 2);
            if (urldecode($kv[0]) === $name) {
                $out[] = urldecode($kv[1] ?? '');
            }
        }

        return $out;
    }

    /** @return list<string> */
    private static function pathParts(string $path): array
    {
        $parts = explode('/', $path);
        array_shift($parts);
        if (count($parts) > 1 && end($parts) === '') {
            array_pop($parts);
        }

        return $parts;
    }

    /** @return array{provider: string, embed: string, poster: string} */
    private static function youtube(string $id): array
    {
        return [
            'provider' => 'YouTube',
            'embed' => "https://www.youtube-nocookie.com/embed/$id",
            'poster' => "https://i.ytimg.com/vi/$id/hqdefault.jpg",
        ];
    }

    /** @return array{provider: string, embed: string} */
    private static function vimeo(string $id, ?string $hash): array
    {
        $query = $hash !== null && preg_match(self::VIMEO_HASH, $hash) ? "?h=$hash" : '';

        return ['provider' => 'Vimeo', 'embed' => "https://player.vimeo.com/video/$id$query"];
    }
}
