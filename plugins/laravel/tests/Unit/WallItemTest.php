<?php

use Diazoma\Laravel\Support\WallItem;
use Diazoma\Laravel\Support\WallPage;

function item(array $over = []): WallItem
{
    return new WallItem(...array_merge([
        'id' => '1', 'link' => '/a/1', 'image' => 'https://cdn.example.com/1.jpg', 'aspect' => 1.5,
    ], $over));
}

it('drops nulls and empty collections', function () {
    expect(item()->toArray())->toBe([
        'id' => '1', 'link' => '/a/1', 'image' => 'https://cdn.example.com/1.jpg', 'aspect' => 1.5,
    ]);
});

it('maps optional fields to spec names', function () {
    $a = item(['imageFocus' => 'f', 'imageFull' => 'u', 'badges' => ['new'], 'meta' => ['price' => '1 €']])->toArray();

    expect($a)->toMatchArray(['image_focus' => 'f', 'image_full' => 'u', 'badges' => ['new'], 'meta' => ['price' => '1 €']]);
});

it('accepts absolute and root-relative links', function (string $link) {
    expect(item(['link' => $link])->link)->toBe($link);
})->with(['/x', 'https://example.com/x', 'http://example.com']);

it('rejects invalid core fields', function (array $over) {
    item($over);
})->with([
    'empty id' => [['id' => '']],
    'relative link' => [['link' => 'listing/1']],
    'protocol-relative link' => [['link' => '//evil.example/x']],
    'javascript link' => [['link' => 'javascript:alert(1)']],
    'empty image' => [['image' => '']],
    'zero aspect' => [['aspect' => 0.0]],
    'negative aspect' => [['aspect' => -1.0]],
    'nan aspect' => [['aspect' => NAN]],
])->throws(InvalidArgumentException::class);

it('omits next on the last page', function () {
    expect((new WallPage([item()]))->toArray())->not->toHaveKey('next')
        ->and((new WallPage([item()], 'abc'))->toArray()['next'])->toBe('abc');
});

it('builds a text card from a title alone and leaves image and aspect out', function () {
    $card = new WallItem(id: '9', link: '/act/9', title: 'Act 9', subtitle: 'Parliament', badges: ['Law']);

    expect($card->toArray())->toBe([
        'id' => '9', 'link' => '/act/9', 'title' => 'Act 9', 'subtitle' => 'Parliament', 'badges' => ['Law'],
    ]);
});

it('maps excerpt, date and accent to spec names', function () {
    $a = (new WallItem(id: '9', link: '/a', title: 'T', excerpt: '  Plain text  ', date: '2026-10-10', accent: '#A1B2C3'))->toArray();

    expect($a)->toMatchArray(['excerpt' => 'Plain text', 'date' => '2026-10-10', 'accent' => '#A1B2C3']);
});

it('formats a DateTimeInterface as ISO 8601', function () {
    $a = (new WallItem(id: '9', link: '/a', title: 'T', date: new DateTimeImmutable('2026-10-10 12:30:00', new DateTimeZone('+03:00'))))->toArray();

    expect($a['date'])->toBe('2026-10-10T12:30:00+03:00');
});

it('cuts a long excerpt to 500 characters with an ellipsis, counting characters not bytes', function () {
    $a = (new WallItem(id: '9', link: '/a', title: 'T', excerpt: str_repeat('ж', 800)))->toArray();

    expect(mb_strlen($a['excerpt']))->toBe(500)
        ->and(mb_substr($a['excerpt'], -1))->toBe('…');
});

it('drops an empty excerpt', function () {
    expect((new WallItem(id: '9', link: '/a', title: 'T', excerpt: '   '))->toArray())->not->toHaveKey('excerpt');
});

it('rejects an item without an image and without a title', function (array $over) {
    new WallItem(...array_merge(['id' => '1', 'link' => '/a'], $over));
})->with([
    'nothing' => [[]],
    'blank title' => [['title' => '  ']],
    'only an excerpt' => [['excerpt' => 'x']],
    'aspect only' => [['aspect' => 1.0]],
])->throws(InvalidArgumentException::class);

it('rejects an image without an aspect, and a bad date or accent', function (array $over) {
    new WallItem(...array_merge(['id' => '1', 'link' => '/a', 'title' => 'T'], $over));
})->with([
    'image without aspect' => [['image' => 'https://x/y.jpg']],
    'zero aspect on a text card' => [['aspect' => 0.0]],
    'text date' => [['date' => 'yesterday']],
    'dotted date' => [['date' => '10.10.2026']],
    'named accent' => [['accent' => 'red']],
    'short accent' => [['accent' => '#12']],
    'accent without hash' => [['accent' => 'a1b2c3']],
])->throws(InvalidArgumentException::class);

const YT = 'dQw4w9WgXcQ';

it('infers media_type video and video_type from the video URL', function (string $video, string $type) {
    expect(item(['video' => $video])->toArray())->toMatchArray(['video' => $video, 'media_type' => 'video', 'video_type' => $type]);
})->with([
    'mp4' => ['https://cdn.example.com/a.mp4', 'file'],
    'hls' => ['https://cdn.example.com/a.m3u8?token=1', 'hls'],
    'dash' => ['https://cdn.example.com/a.MPD', 'dash'],
    'relative' => ['/media/a.webm', 'file'],
]);

it('keeps an explicit mediaType and videoType, and leaves media_type out without a video', function () {
    expect(item(['video' => '/a.mp4', 'mediaType' => 'gif', 'videoType' => 'hls'])->toArray())->toMatchArray(['media_type' => 'gif', 'video_type' => 'hls'])
        ->and(item()->toArray())->not->toHaveKeys(['media_type', 'video_type', 'video']);
});

it('rejects an unknown mediaType and an unplayable without a provider', function (array $over) {
    item($over);
})->with([
    'media type' => [['mediaType' => 'audio']],
    'no provider' => [['unplayable' => ['embed' => 'https://player.vimeo.com/video/1']]],
])->throws(InvalidArgumentException::class);

it('drops a video that is not a web URL', function (string $video) {
    expect(item(['video' => $video])->toArray())->not->toHaveKeys(['video', 'media_type', 'video_type']);
})->with(['javascript:alert(1)', 'data:video/mp4;base64,AA', 'file:///etc/passwd', ' javascript:alert(1)']);

it('keeps at most 8 valid sources, drops bad entries and sets video from the first source', function () {
    $sources = [['src' => 'javascript:x'], ['src' => ''], ['height' => 720], 'x', ['src' => '/a.m3u8', 'type' => 'hls', 'height' => 1080, 'codecs' => 'avc1.640028', 'bitrate' => 5000000]];
    foreach (range(1, 10) as $i) {
        $sources[] = ['src' => "/$i.mp4"];
    }
    $a = item(['videoSources' => $sources])->toArray();

    expect($a['video_sources'])->toHaveCount(8)
        ->and($a['video_sources'][0])->toBe(['src' => '/a.m3u8', 'type' => 'hls', 'height' => 1080, 'codecs' => 'avc1.640028', 'bitrate' => 5000000])
        ->and($a['video'])->toBe('/a.m3u8')
        ->and($a['video_type'])->toBe('hls')
        ->and($a['media_type'])->toBe('video');
});

it('drops bad height, bitrate, type and codecs inside a source, and leaves video alone when set', function () {
    $a = item(['video' => '/main.mp4', 'videoSources' => [['src' => '/a.mp4', 'height' => 0, 'bitrate' => -1, 'type' => 'mp4', 'codecs' => 5], ['src' => '/b.mp4', 'height' => 7.5]]])->toArray();

    expect($a['video'])->toBe('/main.mp4')
        ->and($a['video_sources'])->toBe([['src' => '/a.mp4'], ['src' => '/b.mp4']]);
});

it('omits video_sources when none is valid', function () {
    expect(item(['videoSources' => [['src' => 'ftp://x/a.mp4']]])->toArray())->not->toHaveKey('video_sources');
});

it('keeps a duration of 0 or more and drops the rest', function (mixed $duration, bool $kept) {
    expect(array_key_exists('duration', item(['duration' => $duration])->toArray()))->toBe($kept);
})->with([[0, true], [61.5, true], [-1, false], [NAN, false], [INF, false]]);

it('turns every YouTube and Vimeo form in video into an embed', function (string $url, string $provider, string $embed) {
    $a = item(['video' => $url, 'title' => 'T'])->toArray();

    expect($a)->not->toHaveKey('video')
        ->and($a['media_type'])->toBe('video')
        ->and($a['unplayable'])->toBe(['provider' => $provider, 'embed' => $embed])
        ->and($a['image'])->toBe('https://cdn.example.com/1.jpg');
})->with([
    'watch' => ['https://www.youtube.com/watch?v='.YT, 'YouTube', 'https://www.youtube-nocookie.com/embed/'.YT],
    'watch with list' => ['https://youtube.com/watch?v='.YT.'&t=4s&list=PL1', 'YouTube', 'https://www.youtube-nocookie.com/embed/'.YT],
    'mobile' => ['https://m.youtube.com/watch?v='.YT, 'YouTube', 'https://www.youtube-nocookie.com/embed/'.YT],
    'youtu.be' => ['https://youtu.be/'.YT.'?si=a', 'YouTube', 'https://www.youtube-nocookie.com/embed/'.YT],
    'shorts' => ['https://www.youtube.com/shorts/'.YT, 'YouTube', 'https://www.youtube-nocookie.com/embed/'.YT],
    'embed' => ['https://www.youtube.com/embed/'.YT, 'YouTube', 'https://www.youtube-nocookie.com/embed/'.YT],
    'nocookie' => ['https://www.youtube-nocookie.com/embed/'.YT, 'YouTube', 'https://www.youtube-nocookie.com/embed/'.YT],
    'vimeo' => ['https://vimeo.com/76979871', 'Vimeo', 'https://player.vimeo.com/video/76979871'],
    'vimeo hash' => ['https://vimeo.com/76979871/abcdef1234', 'Vimeo', 'https://player.vimeo.com/video/76979871?h=abcdef1234'],
    'player' => ['https://player.vimeo.com/video/76979871', 'Vimeo', 'https://player.vimeo.com/video/76979871'],
    'player hash' => ['https://player.vimeo.com/video/76979871?h=abcdef1234&autoplay=1', 'Vimeo', 'https://player.vimeo.com/video/76979871?h=abcdef1234'],
]);

it('does not treat a lookalike or a malformed URL as YouTube or Vimeo', function (string $url) {
    $a = item(['video' => $url])->toArray();

    expect($a['video'])->toBe($url)
        ->and($a)->not->toHaveKey('unplayable');
})->with([
    'suffix host' => ['https://youtube.com.evil.example/watch?v='.YT],
    'prefix host' => ['https://evilyoutube.com/watch?v='.YT],
    'userinfo' => ['https://youtube.com@evil.example/watch?v='.YT],
    'path trick' => ['https://evil.example/youtube.com/watch?v='.YT],
    'youtu.be suffix' => ['https://youtu.be.evil.example/'.YT],
    'music host' => ['https://music.youtube.com/watch?v='.YT],
    'mobile shorts' => ['https://m.youtube.com/shorts/'.YT],
    'short id' => ['https://www.youtube.com/watch?v=short'],
    'long id' => ['https://www.youtube.com/watch?v='.YT.'x'],
    'channel' => ['https://www.youtube.com/@channel'],
    'vimeo suffix' => ['https://vimeo.com.evil.example/76979871'],
    'vimeo channel' => ['https://vimeo.com/channels/staffpicks'],
    'player letters' => ['https://player.vimeo.com/video/abc'],
]);

it('gives a YouTube item without an image the hqdefault poster at 16/9, and a Vimeo item only a title', function () {
    $yt = (new WallItem(id: 'y', link: '/y', video: 'https://youtu.be/'.YT))->toArray();
    expect($yt['image'])->toBe('https://i.ytimg.com/vi/'.YT.'/hqdefault.jpg')
        ->and($yt['aspect'])->toBe(16 / 9)
        ->and($yt['media_type'])->toBe('video');

    $vimeo = (new WallItem(id: 'v', link: '/v', title: 'T', video: 'https://vimeo.com/76979871'))->toArray();
    expect($vimeo)->not->toHaveKeys(['image', 'aspect'])
        ->and($vimeo['unplayable']['provider'])->toBe('Vimeo');

    new WallItem(id: 'v', link: '/v', video: 'https://vimeo.com/76979871');
})->throws(InvalidArgumentException::class);

it('recognises an absolute link only when the item has neither video nor mediaType', function () {
    $link = 'https://www.youtube.com/watch?v='.YT;
    $a = (new WallItem(id: 'y', link: $link, title: 'T'))->toArray();
    expect($a)->toMatchArray(['link' => $link, 'media_type' => 'video', 'unplayable' => ['provider' => 'YouTube', 'embed' => 'https://www.youtube-nocookie.com/embed/'.YT]])
        ->and($a['image'])->toBe('https://i.ytimg.com/vi/'.YT.'/hqdefault.jpg');

    expect(item(['link' => $link, 'video' => '/a.mp4'])->toArray())->not->toHaveKey('unplayable')
        ->and(item(['link' => $link, 'mediaType' => 'photo'])->toArray())->not->toHaveKey('unplayable');
});

it('keeps unplayable.embed only on the allowlist', function (string $embed, ?string $kept) {
    $a = item(['mediaType' => 'video', 'unplayable' => ['provider' => 'X', 'embed' => $embed]])->toArray();

    expect($a['unplayable'])->toBe($kept === null ? ['provider' => 'X'] : ['provider' => 'X', 'embed' => $kept]);
})->with([
    'nocookie' => ['https://www.youtube-nocookie.com/embed/'.YT, 'https://www.youtube-nocookie.com/embed/'.YT],
    'youtube rewritten' => ['https://www.youtube.com/embed/'.YT.'?autoplay=1', 'https://www.youtube-nocookie.com/embed/'.YT],
    'vimeo with hash' => ['https://player.vimeo.com/video/1?h=abc', 'https://player.vimeo.com/video/1?h=abc'],
    'http' => ['http://www.youtube-nocookie.com/embed/'.YT, null],
    'lookalike' => ['https://www.youtube.com.evil.example/embed/'.YT, null],
    'other host' => ['https://evil.example/player', null],
    'watch page' => ['https://www.youtube.com/watch?v='.YT, null],
]);

it('takes videoType from the first source when video comes from it', function () {
    expect(item(['videoSources' => [['src' => 'https://cdn.example.com/x/master', 'type' => 'hls']]])->toArray()['video_type'])->toBe('hls')
        ->and(item(['videoSources' => [['src' => 'https://cdn.example.com/x/master.mpd', 'type' => 'file']]])->toArray()['video_type'])->toBe('file')
        ->and(item(['videoSources' => [['src' => '/x/a.m3u8']]])->toArray()['video_type'])->toBe('hls')
        ->and(item(['video' => '/v', 'videoSources' => [['src' => '/x', 'type' => 'hls']]])->toArray()['video_type'])->toBe('file');
});

it('does not recognise a repeated v or h, a backslash, and trims whitespace', function (string $url, bool $hosted) {
    $a = item(['video' => $url])->toArray();

    expect(array_key_exists('unplayable', $a))->toBe($hosted);
})->with([
    'repeated v' => ['https://www.youtube.com/watch?v='.YT.'&v='.YT, false],
    'repeated v other' => ['https://www.youtube.com/watch?v='.YT.'&v=aaaaaaaaaaa', false],
    'repeated h' => ['https://player.vimeo.com/video/76979871?h=abcdef1234&h=zzzz', false],
    'backslash userinfo' => ['https://evil.example\\@www.youtube.com/watch?v='.YT, false],
    'backslash path' => ['https://www.youtube.com\\watch?v='.YT, false],
    'leading space' => ['  https://youtu.be/'.YT, true],
    'trailing newline' => ["https://youtu.be/".YT."\n", true],
]);

it('refuses an embed with a repeated h or a backslash and trims an embed', function () {
    expect(\Diazoma\Laravel\Support\VideoUrl::allowedEmbed('https://player.vimeo.com/video/1?h=a&h=b'))->toBeNull()
        ->and(\Diazoma\Laravel\Support\VideoUrl::allowedEmbed('https://evil.example\\@www.youtube.com/embed/'.YT))->toBeNull()
        ->and(\Diazoma\Laravel\Support\VideoUrl::allowedEmbed(' https://www.youtube.com/embed/'.YT.' '))->toBe('https://www.youtube-nocookie.com/embed/'.YT);
});
