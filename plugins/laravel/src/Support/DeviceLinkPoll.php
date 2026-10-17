<?php

namespace Diazoma\Laravel\Support;

use Illuminate\Contracts\Auth\Authenticatable;

final readonly class DeviceLinkPoll
{
    /** @param 'pending'|'approved'|'expired' $status */
    public function __construct(
        public string $status,
        public ?Authenticatable $user = null,
    ) {
    }
}
