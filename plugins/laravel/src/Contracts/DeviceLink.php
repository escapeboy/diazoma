<?php

namespace Diazoma\Laravel\Contracts;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\Request;
use Diazoma\Laravel\Support\DeviceLinkPoll;
use Diazoma\Laravel\Support\DeviceLinkStart;

/**
 * Password-free sign-in for a headset: the headset shows a short code, the user
 * approves it on a phone where they are already signed in, and the headset's own
 * session picks up the login. This package ships the contract only, no
 * implementation and no routes.
 *
 * Security contract an implementation must keep:
 *  - A code is single-use. Once approved and collected, or expired, it is gone.
 *  - A code lives at most 10 minutes.
 *  - The code alone is not enough. start() also creates a random secret that is
 *    held only in the polling session; poll() must check it, so someone who
 *    sees or guesses the code cannot collect the login.
 *  - start(), poll() and approve() are throttled per client.
 *  - The session is regenerated when the login is collected, to prevent fixation.
 *  - The code alphabet leaves out look-alike characters (0/O, 1/I/L) because it
 *    is read off a headset panel and typed on a phone.
 */
interface DeviceLink
{
    public function start(Request $request): DeviceLinkStart;

    public function poll(Request $request): DeviceLinkPoll;

    /** Called from the phone by a signed-in user. False when the code is unknown, used or expired. */
    public function approve(string $code, Authenticatable $user): bool;
}
