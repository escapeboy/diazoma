<?php

namespace Diazoma\Laravel\Tests\Fixtures;

use Closure;
use Illuminate\Http\Request;

class DenyAll
{
    public function handle(Request $request, Closure $next)
    {
        abort(451);
    }
}
