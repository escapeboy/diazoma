# On-device QA for @diazoma/wall

What only a headset can prove. The headless harness (`pnpm --filter @diazoma/wall harness`) covers the logic with simulated input; nothing below is done until someone ticks it on a real device. Run it on Quest 2 and Quest 3, and again on every other platform the input profile is claimed for (Pico, Android XR).

How to look inside: open the page, then in the remote DevTools console `__diazoma.state()` shows the scene snapshot, `__diazoma.scope` the current scope, `__diazoma.route` the path of the wall's page, `__diazoma.version` the build. Quest Browser is debugged over USB: Developer Mode on, `adb devices`, then `chrome://inspect#devices` in desktop Chrome.

## Entry

- [ ] The page shows the wall in the browser (magic window) and, on a headset, a big full-screen Enter VR card. The whole card is the target, not only its button.
- [ ] Where the browser offers its own Enter VR button (`navigator.xr.offerSession`), using it enters the same session.
- [ ] A desktop browser without a headset shows the wall with mouse drag, wheel and click, and no Enter VR card.
- [ ] A headset that refuses the session (permission denied or unsupported) leaves the page usable and reports an error event.

## Wall and navigation

- [ ] Curved wall of three rows at eye height; title and filter tabs above, scope bar and progress below.
- [ ] Thumbstick left/right scrolls with inertia and stops at both ends. Releasing coasts to a stop.
- [ ] Grip plus sweeping the controller drags the wall; releasing keeps the momentum.
- [ ] Trigger plus moving the controller drags after 0.035 rad of travel; a short press selects.
- [ ] Pointing at a card lifts it and shows its title and creator.
- [ ] Trigger on a card opens the viewer in front of you with a sharper image; the wall steps back.
- [ ] Filter tabs reload the wall. Back returns to the previous source at the same spot.
- [ ] Scroll through 500 or more cards: pages keep loading, no card stays blank, no stutter below 60 fps (DevTools Performance over adb), at most 60 live textures.
- [ ] System menu and back: the scene resumes where it was. Leaving VR returns to the in-page wall at the same position.
- [ ] Settings: height, distance, sounds, environment, active hand and resume time persist after a reload.
- [ ] Reload the page: the place (scope, filters, scroll, open item) comes back within the chosen resume time; a different account or a guest does not get it.

## Viewer

- [ ] Thumbstick flick or a controller sweep goes to the previous or next item; the next three items open at once (their sharp images were prefetched).
- [ ] Zoom with the thumbstick, the - / + buttons and by pulling the controller towards you; 20 cm of pull is about 2.5x.
- [ ] Like, save to a collection (existing and new), follow, watch later and slideshow work when signed in; a guest is asked to sign in and the action finishes afterwards.
- [ ] An item that cannot play in VR (third-party embed) shows the notice and a "watch in the browser" primary button, and plays nothing.
- [ ] Open page asks twice (tap again within 3 s), then leaves VR and opens the item page. Exit VR asks twice as well.
- [ ] Hold A or X opens the item page; B or Y goes back.

## Natural hands

- [ ] Pointing with the index finger and holding still for 0.8 s selects; the ring fills while you hold.
- [ ] After a select the next one needs the finger to move 0.08 rad.
- [ ] In the viewer, a finger kept on - / + repeats the step every 0.35 s.
- [ ] A fist grabs after 0.15 s; moving it sideways drags; pulling or pushing zooms (locks after 4 cm).
- [ ] A fist held still for 2 s hides everything; a resting hand curled into a fist does not hide it earlier.
- [ ] One hand is enough, either hand. A hand resting low does not trigger anything while the other is raised.
- [ ] Hand diagnostics (settings) show the pose each hand reads as and send samples when switched on.

## Quick hide

- [ ] Holding a pinch or trigger on empty space for 1 s, both grips for 0.8 s, or H on a keyboard hides everything.
- [ ] While hidden a visible hint says how to bring it back, and it dims after a few seconds.
- [ ] Leaving VR while hidden shows everything again on the next session.

## Telemetry

- [ ] No error events in a 10-minute session; memory stays flat (DevTools Memory over adb).
- [ ] A session produces enter, backend, perf (every 60 s and at the end) and exit events with `by` set to `app` or `system`.
- [ ] A context loss (low memory) is reported as an error event and the scene recovers.

## Textures and media origins

- [ ] Every image host sends `Access-Control-Allow-Origin` (otherwise cards stay grey placeholders or show their title). `@diazoma/spec validate` checks this for a site.
- [ ] A headset that browsed the 2D site before CORS was enabled still shows the cards: the `xr=1` marker URL is requested first, with exactly one retry on a unique URL.
- [ ] Videos are same-origin or CORS-enabled and support byte ranges.

## Parity checklist (harness scenarios as device checks)

Every item of the original implementation log is a scenario of the headless harness. On a device, repeat the ones that depend on real hardware.

| ID | Check on the device |
|---|---|
| P-01 | Cards load on a headset with a warm pre-CORS cache; the network panel shows `xr=1` first and at most one retry per card |
| P-02 | `renderer.getContext().getContextAttributes().antialias` is true; card edges do not crawl; foveation 0.5 |
| P-03 | The Enter VR card is big, full screen, and the whole card enters VR |
| P-04 | Dwell select at 0.8 s, re-arm after 0.08 rad, - / + repeat every 0.35 s |
| P-05 | Fist under 0.15 s does not drag; longer does |
| P-06 | A still fist hides after 2 s and an `xr_hide` event is sent |
| P-07 | Pull of 4 cm locks zoom; 20 cm is about 2.5x |
| P-08 | Controller press drags at 0.035 rad, hand press at 0.07 rad |
| P-09 | Exit and open page need a second select within 3 s |
| P-10 | Quick hide shows the hint and resets on session end |
| P-11 | Embeds show "watch in the browser" and do not play |
| P-12 | Cursor feed pages through the whole catalog without duplicates and stops at the end |
| P-13 | A thrown error in the frame loop does not blank the scene; one error event per distinct error |
| P-14 | A context loss produces a `context_lost` error event |
| P-15 | The event sequence of a session matches the playbook |
| P-16 | At most 6 parallel image loads, centre-out order, at most 60 textures |
| P-17 | The next three focus images are requested once and released when out of the window |
| P-18 | `state()` has the documented keys after use |

## Rollout gates carried over from the first host site QA

- [ ] The age or access gate of the host site is enforced on the wall page and its feed endpoints.
- [ ] Thermal: 20 minutes of use on Quest 2 without throttling stutter.
