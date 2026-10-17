<?php

namespace Diazoma\Laravel\Concerns;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Database\Eloquent\Model;
use Diazoma\Laravel\Support\WallItem;
use Diazoma\Laravel\Support\WallPage;
use Diazoma\Laravel\Support\WallRequest;

/**
 * Keyset-paginated wall feed over an Eloquent query. The primary key is the
 * final tiebreaker, so UUID and integer keys both work and rows that share a
 * sort value are neither repeated nor skipped.
 */
trait ProducesWallFeed
{
    abstract protected function wallQuery(): Builder;

    abstract protected function wallItem(Model $model): WallItem;

    /** @return array<string, 'asc'|'desc'> */
    abstract protected function wallSort(): array;

    /** @return list<string> columns matched with LIKE by the `q` parameter */
    protected function wallSearchColumns(): array
    {
        return [];
    }

    /** @return array<string, string> request filter name => column (equality) */
    protected function wallFilters(): array
    {
        return [];
    }

    public function wallPage(WallRequest $request): WallPage
    {
        $query = $this->wallQuery();
        $keyName = $query->getModel()->getKeyName();
        $sort = $this->wallSort();
        $limit = max(1, $request->limit);

        $this->applyWallFilters($query, $request);

        $order = $sort + [$keyName => $this->wallKeyDirection($sort)];
        $columns = array_keys($order);

        $after = $this->decodeWallCursor($request->cursor, count($columns));
        if ($after !== null) {
            $this->applyWallKeyset($query, $order, $after);
        }

        foreach ($order as $column => $direction) {
            $query->orderBy($column, $direction);
        }

        try {
            $rows = $query->limit($limit + 1)->get();
        } catch (QueryException $e) {
            // A cursor value the checks let through that the column cannot hold (say a number too big for a smallint).
            if ($after === null || ! $this->isWallInputError($e)) {
                throw $e;
            }

            return $this->wallPage(new WallRequest(cursor: null, query: $request->query, filters: $request->filters, limit: $request->limit));
        }
        $hasMore = $rows->count() > $limit;
        $rows = $rows->take($limit)->values();

        $items = $rows->map(fn (Model $model) => $this->wallItem($model))->all();
        $next = $hasMore && $rows->isNotEmpty()
            ? $this->encodeWallCursor($rows->last(), $columns)
            : null;

        return new WallPage($items, $next);
    }

    /** Only the SQLSTATEs a bad value in the cursor raises: 22003 number out of range, 22007 and 22008 date, 22P02 bad text for a uuid or integer. A lock timeout, a deadlock or a missing column must still surface. */
    private function isWallInputError(QueryException $e): bool
    {
        $previous = $e->getPrevious();
        $state = (string) ($previous instanceof \PDOException ? ($previous->errorInfo[0] ?? $previous->getCode()) : $e->getCode());
        if (! preg_match('/^[0-9A-Z]{5}$/', $state) && preg_match('/SQLSTATE\[([0-9A-Z]{5})\]/', $e->getMessage(), $m)) {
            $state = $m[1];
        }

        return in_array($state, ['22003', '22007', '22008', '22P02'], true);
    }

    private function applyWallFilters(Builder $query, WallRequest $request): void
    {
        $term = trim((string) $request->query);
        $searchColumns = $this->wallSearchColumns();
        if ($term !== '' && $searchColumns !== []) {
            $like = '%'.addcslashes($term, '\\%_').'%';
            $query->where(function (Builder $q) use ($searchColumns, $like) {
                foreach ($searchColumns as $column) {
                    $q->orWhere($column, 'like', $like);
                }
            });
        }

        foreach ($this->wallFilters() as $name => $column) {
            $value = $request->filters[$name] ?? null;
            if ($value !== null && $value !== '' && $value !== 'all') {
                $query->where($column, $value);
            }
        }
    }

    /** @param array<string, 'asc'|'desc'> $sort */
    private function wallKeyDirection(array $sort): string
    {
        return $sort === [] ? 'asc' : reset($sort);
    }

    /**
     * (c1 < v1) OR (c1 = v1 AND c2 < v2) OR ... with the operator following each column's direction.
     *
     * @param  array<string, 'asc'|'desc'>  $order
     * @param  list<mixed>  $after
     */
    private function applyWallKeyset(Builder $query, array $order, array $after): void
    {
        $columns = array_keys($order);

        $query->where(function (Builder $outer) use ($order, $columns, $after) {
            foreach ($columns as $i => $column) {
                $outer->orWhere(function (Builder $branch) use ($order, $columns, $after, $i, $column) {
                    for ($j = 0; $j < $i; $j++) {
                        $branch->where($columns[$j], '=', $after[$j]);
                    }
                    $operator = strtolower($order[$column]) === 'desc' ? '<' : '>';
                    $branch->where($column, $operator, $after[$i]);
                });
            }
        });
    }

    /** @param list<string> $columns */
    private function encodeWallCursor(Model $last, array $columns): string
    {
        $values = array_map(fn (string $column) => $last->getRawOriginal($column), $columns);

        return rtrim(strtr(base64_encode(json_encode($values, JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
    }

    /** @return list<scalar>|null null on any malformed cursor, which means the first page */
    private function decodeWallCursor(?string $cursor, int $width): ?array
    {
        if ($cursor === null || $cursor === '') {
            return null;
        }

        $raw = base64_decode(strtr($cursor, '-_', '+/'), true);
        $values = $raw === false ? null : json_decode($raw, true);

        if (! is_array($values) || ! array_is_list($values) || count($values) !== $width) {
            return null;
        }

        foreach ($values as $value) {
            if (! $this->isSafeWallCursorValue($value)) {
                return null;
            }
        }

        return $values;
    }

    /**
     * A cursor value is bound into SQL, so the database rejects what it cannot store (a date out of range,
     * a number too big for the column) with an error. Only values a real row could hold get through.
     */
    private function isSafeWallCursorValue(mixed $value): bool
    {
        if (is_int($value)) {
            return true;
        }
        if (is_float($value)) {
            return is_finite($value) && abs($value) < 1.0e15;
        }
        if (! is_string($value) || strlen($value) > 255) {
            return false;
        }
        if (preg_match('/^\d{4}-/', $value) !== 1) {
            return true;
        }
        if (preg_match('/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/', $value, $m) !== 1) {
            return false;
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $m[1]);
        if ($date === false || $date->format('Y-m-d') !== $m[1] || (int) $date->format('Y') < 1800) {
            return false;
        }
        if (isset($m[2])) {
            $time = \DateTimeImmutable::createFromFormat('!H:i:s', $m[2]);

            return $time !== false && $time->format('H:i:s') === $m[2];
        }

        return true;
    }
}
