<?php

namespace Diazoma\Laravel\Support;

final readonly class WallPage
{
    /** @param list<WallItem> $items */
    public function __construct(
        public array $items,
        public ?string $next = null,
    ) {
    }

    /** @return array{items: list<array<string, mixed>>, next?: string} */
    public function toArray(): array
    {
        $page = ['items' => array_map(fn (WallItem $item) => $item->toArray(), $this->items)];

        if ($this->next !== null) {
            $page['next'] = $this->next;
        }

        return $page;
    }
}
