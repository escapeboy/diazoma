<?php

namespace Diazoma\Laravel\Contracts;

use Diazoma\Laravel\Support\WallPage;
use Diazoma\Laravel\Support\WallRequest;

interface WallFeed
{
    public function wallPage(WallRequest $request): WallPage;
}
