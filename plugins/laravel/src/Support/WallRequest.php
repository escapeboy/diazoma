<?php

namespace Diazoma\Laravel\Support;

final readonly class WallRequest
{
    /** @param array<string, string> $filters */
    public function __construct(
        public ?string $cursor = null,
        public ?string $query = null,
        public array $filters = [],
        public int $limit = 50,
    ) {
    }
}
