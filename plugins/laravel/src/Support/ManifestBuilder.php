<?php

namespace Diazoma\Laravel\Support;

final class ManifestBuilder
{
    /** @param array<string, mixed> $config the full `diazoma` config */
    public function __construct(private readonly array $config)
    {
    }

    /** @return array<string, mixed> */
    public function build(): array
    {
        $manifest = $this->config['manifest'] ?? [];
        $embed = $this->config['embed'] ?? [];

        $document = [
            'version' => 1,
            'policy' => $manifest['policy'] ?? 'allow',
            'name' => $manifest['name'] ?? null,
            'brand' => $manifest['brand'] ?? [],
            'feeds' => $this->feeds(),
            'filters' => $manifest['filters'] ?? [],
            'media' => $manifest['media'] ?? [],
            'actions' => $manifest['actions'] ?? [],
            'auth' => $manifest['auth'] ?? [],
            'recipe' => $manifest['recipe'] ?? null,
            'embed' => ($embed['advertise'] ?? $embed['enabled'] ?? false) ? ['route' => $embed['route'] ?? '/xr'] : [],
        ];

        $document = $this->prune($document);

        // Not pruned: a null inside a view is meaningful (`wall.indicator: null` draws no mark).
        $view = is_array($manifest['view'] ?? null) ? $this->viewObjects($manifest['view']) : [];
        if ($view !== []) {
            $document['view'] = $view;
        }

        return $document;
    }

    /**
     * PHP has one array type, so an empty `[]` would be sent as a JSON list where the view schema
     * wants an object (`strings`, `metaLabels`, …). An empty object changes nothing, so it is left
     * out; an empty list is kept where the view has lists (`side: []` means no links).
     *
     * @param  array<mixed>  $value
     * @return array<mixed>
     */
    private function viewObjects(array $value): array
    {
        foreach ($value as $key => $item) {
            if (! is_array($item) || in_array($key, ['fields', 'side', 'labelFields'], true)) {
                continue;
            }
            // Recurse first: an object can become empty once its own empty objects are gone.
            $item = array_is_list($item) && $item !== [] ? $item : $this->viewObjects($item);
            if ($item === []) {
                unset($value[$key]);
            } else {
                $value[$key] = $item;
            }
        }

        return $value;
    }

    /** @return list<array<string, mixed>> */
    private function feeds(): array
    {
        $prefix = '/'.trim((string) ($this->config['route_prefix'] ?? 'wall'), '/');
        $feeds = [];

        foreach ($this->config['feeds'] ?? [] as $id => $feed) {
            $url = $prefix.'/feed/'.rawurlencode((string) $id);
            $feeds[] = [
                'id' => (string) $id,
                'title' => $feed['title'] ?? (string) $id,
                'url' => $url,
                'cursor' => true,
            ];

            if ($feed['search'] ?? false) {
                $feeds[] = [
                    'id' => $id.'-search',
                    'title' => $feed['title'] ?? (string) $id,
                    'type' => 'search',
                    'url' => $url.'?q={query}',
                ];
            }
        }

        return $feeds;
    }

    /**
     * Drops null values and empty arrays at every depth, except inside `feeds`
     * entries, which are already built clean.
     *
     * @param  array<mixed>  $value
     * @return array<mixed>
     */
    private function prune(array $value): array
    {
        foreach ($value as $key => $item) {
            if (is_array($item)) {
                $item = $this->prune($item);
            }
            if ($item === null || $item === []) {
                unset($value[$key]);
            } else {
                $value[$key] = $item;
            }
        }

        return $value;
    }
}
