<?php

namespace Diazoma\Laravel\Support;

use DateTimeInterface;

final readonly class DeviceLinkStart
{
    public function __construct(
        public string $code,
        public string $url,
        public DateTimeInterface $expiresAt,
    ) {
    }
}
