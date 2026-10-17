<?php

use Diazoma\Laravel\Tests\Fixtures\IntPost;
use Diazoma\Laravel\Tests\Fixtures\UuidPost;

/** 120 rows, 12 distinct timestamps so every sort value is shared by 10 rows. */
function seedPosts(string $model): void
{
    for ($i = 1; $i <= 120; $i++) {
        $model::create([
            'title' => "Post $i".($i % 10 === 0 ? ' special' : ''),
            'kind' => $i % 2 === 0 ? 'photo' : 'video',
            'created_at' => now()->startOfDay()->addMinutes(intdiv($i - 1, 10)),
        ]);
    }
}

/** @return list<string> every id reached by following `next` */
function walkFeed(string $feed, string $query = ''): array
{
    $ids = [];
    $cursor = null;
    $pages = 0;

    do {
        $url = "/wall/feed/$feed?limit=25".($cursor ? '&cursor='.$cursor : '').$query;
        $json = test()->getJson($url)->assertOk()->json();
        array_push($ids, ...array_column($json['items'], 'id'));
        $cursor = $json['next'] ?? null;
        $pages++;
    } while ($cursor !== null && $pages < 20);

    return $ids;
}

dataset('feeds', [
    'uuid key' => ['uuid', UuidPost::class],
    'int key' => ['int', IntPost::class],
]);

it('pages through 120 rows without duplicates or gaps', function (string $feed, string $model) {
    seedPosts($model);

    $ids = walkFeed($feed);
    $expected = $model::query()->orderByDesc('created_at')->orderByDesc((new $model())->getKeyName())
        ->pluck((new $model())->getKeyName())->map(fn ($id) => (string) $id)->all();

    expect($ids)->toHaveCount(120)
        ->and(array_unique($ids))->toHaveCount(120)
        ->and($ids)->toBe($expected);
})->with('feeds');

it('keeps ties in the sort column stable', function (string $feed, string $model) {
    for ($i = 0; $i < 30; $i++) {
        $model::create(['title' => "Tie $i", 'created_at' => '2026-01-01 00:00:00']);
    }

    expect(array_unique(walkFeed($feed)))->toHaveCount(30);
})->with('feeds');

it('serves the first page for a malformed cursor', function (string $feed, string $model) {
    seedPosts($model);
    $first = $this->getJson("/wall/feed/$feed?limit=25")->json('items.0.id');

    foreach (['not-a-cursor', '%%%', rtrim(strtr(base64_encode('[1]'), '+/', '-_'), '='), rtrim(strtr(base64_encode('{"a":1}'), '+/', '-_'), '=')] as $bad) {
        $this->getJson("/wall/feed/$feed?limit=25&cursor=$bad")
            ->assertOk()
            ->assertJsonPath('items.0.id', $first);
    }
})->with('feeds');

it('serves the first page for cursor values a database would reject', function (string $feed, string $model) {
    seedPosts($model);
    $first = $this->getJson("/wall/feed/$feed?limit=25")->json('items.0.id');
    $real = json_decode(base64_decode(strtr($this->getJson("/wall/feed/$feed?limit=25")->json('next'), '-_', '+/')), true);
    $enc = fn (array $v) => rtrim(strtr(base64_encode(json_encode($v)), '+/', '-_'), '=');

    $bad = [
        '2024-13-45', '0000-01-01', '1799-12-31', '2024-02-30', '2024-01-01 25:00:00', '2024-01-01 12:61:00',
        99999999999999999999, str_repeat('a', 300), true, null, ['a'],
    ];
    foreach ($bad as $value) {
        foreach (array_keys($real) as $position) {
            $values = $real;
            $values[$position] = $value;
            $this->getJson("/wall/feed/$feed?limit=25&cursor=".$enc($values))->assertOk()->assertJsonPath('items.0.id', $first);
        }
    }
    // A column too small for the number: the query fails, the page is still the first one.
    $values = $real;
    $values[count($values) - 1] = 99999999999999;
    $this->getJson("/wall/feed/$feed?limit=25&cursor=".$enc($values))->assertOk();
})->with('feeds');

function failNextCursorQuery(string $sqlState): void
{
    $armed = true;
    \Illuminate\Support\Facades\DB::connection()->beforeExecuting(function ($sql) use (&$armed, $sqlState) {
        if ($armed && str_contains(strtolower($sql), 'limit')) {
            $armed = false;
            $pdo = new \PDOException("SQLSTATE[$sqlState]: simulated");
            $pdo->errorInfo = [$sqlState, 1, 'simulated'];
            throw new \Illuminate\Database\QueryException('testing', $sql, [], $pdo);
        }
    });
}

it('answers page 1 when the database rejects a cursor value (22003, 22007, 22008, 22P02)', function (string $state) {
    seedPosts(IntPost::class);
    $first = $this->getJson('/wall/feed/int?limit=25')->json();
    failNextCursorQuery($state);
    $this->getJson('/wall/feed/int?limit=25&cursor='.$first['next'])->assertOk()->assertJsonPath('items.0.id', $first['items'][0]['id']);
})->with(['22003', '22007', '22008', '22P02']);

it('lets other database errors on a cursor page surface (lock timeout, deadlock, missing column)', function (string $state) {
    seedPosts(IntPost::class);
    $first = $this->getJson('/wall/feed/int?limit=25')->json();
    failNextCursorQuery($state);
    $this->getJson('/wall/feed/int?limit=25&cursor='.$first['next'])->assertStatus(500);
})->with(['HY000', '40001', '42S22']);

it('has no next on the last page', function () {
    seedPosts(IntPost::class);

    $this->getJson('/wall/feed/int?limit=100')->assertJsonCount(100, 'items')->assertJsonStructure(['next']);
    $json = $this->getJson('/wall/feed/int?limit=100&cursor='.$this->getJson('/wall/feed/int?limit=100')->json('next'))->json();
    expect($json['items'])->toHaveCount(20)->and($json)->not->toHaveKey('next');
});

it('searches feeds that opt in', function () {
    seedPosts(UuidPost::class);

    $ids = walkFeed('uuid', '&q=special');
    expect($ids)->toHaveCount(12);
});

it('ignores q on feeds without search', function () {
    seedPosts(IntPost::class);

    $this->getJson('/wall/feed/int?limit=100&q=special')->assertJsonCount(100, 'items');
});

it('escapes LIKE wildcards in the search term', function () {
    seedPosts(UuidPost::class);

    $this->getJson('/wall/feed/uuid?q=%25')->assertOk()->assertJsonCount(0, 'items');
});

it('applies allow-listed filters and ignores unknown ones', function () {
    seedPosts(UuidPost::class);

    expect(walkFeed('uuid', '&type=video'))->toHaveCount(60)
        ->and(walkFeed('uuid', '&type=all'))->toHaveCount(120)
        ->and(walkFeed('uuid', '&title=nothing'))->toHaveCount(120);
});

it('caps limit at max_per_page and defaults to per_page', function () {
    seedPosts(IntPost::class);
    config()->set('diazoma.max_per_page', 30);

    $this->getJson('/wall/feed/int?limit=500')->assertJsonCount(30, 'items');
    $this->getJson('/wall/feed/int?limit=0')->assertJsonCount(1, 'items');

    config()->set('diazoma.max_per_page', 100);
    $this->getJson('/wall/feed/int')->assertJsonCount(50, 'items');
});

it('returns spec item fields with nulls dropped', function () {
    IntPost::create(['title' => 'One', 'created_at' => now()]);

    $item = $this->getJson('/wall/feed/int')->json('items.0');

    expect($item)->toHaveKeys(['id', 'link', 'image', 'aspect', 'title'])
        ->and($item)->not->toHaveKeys(['subtitle', 'badges', 'meta', 'video'])
        ->and($item['id'])->toBeString();
});

it('404s for an unknown feed', function () {
    $this->getJson('/wall/feed/nope')->assertNotFound();
});
