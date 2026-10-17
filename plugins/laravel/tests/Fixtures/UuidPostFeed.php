<?php

namespace Diazoma\Laravel\Tests\Fixtures;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Diazoma\Laravel\Concerns\ProducesWallFeed;
use Diazoma\Laravel\Contracts\WallFeed;
use Diazoma\Laravel\Support\WallItem;

class UuidPostFeed implements WallFeed
{
    use ProducesWallFeed;

    protected function wallQuery(): Builder
    {
        return UuidPost::query();
    }

    protected function wallItem(Model $model): WallItem
    {
        return new WallItem(
            id: (string) $model->getKey(),
            link: '/posts/'.$model->getKey(),
            image: 'https://cdn.example.com/'.$model->getKey().'.jpg',
            aspect: 1.5,
            title: $model->title,
        );
    }

    protected function wallSort(): array
    {
        return ['created_at' => 'desc'];
    }

    protected function wallSearchColumns(): array
    {
        return ['title'];
    }

    protected function wallFilters(): array
    {
        return ['type' => 'kind'];
    }
}
