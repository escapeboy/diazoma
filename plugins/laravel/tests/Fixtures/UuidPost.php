<?php

namespace Diazoma\Laravel\Tests\Fixtures;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class UuidPost extends Model
{
    use HasUuids;

    public $timestamps = false;

    protected $guarded = [];
}
