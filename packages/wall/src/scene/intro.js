/**
 * Which first-session how-to to show, if any. `sources` are the XR input slots; a slot
 * without an inputSource is disconnected. Hands come first; the controller intro waits
 * for its own turn (the caller only asks when no panel is open).
 *
 * @param {Array<{userData: {inputSource?: object}}>} sources
 * @param {{handIntroSeen?: boolean, controllerIntroSeen?: boolean}} settings
 * @param {(source: object) => boolean} isHand
 * @returns {'hands'|'controllers'|null}
 */
export function introToShow(sources, settings, isHand) {
    const live = sources.filter((c) => c && c.userData && c.userData.inputSource);
    if (!settings.handIntroSeen && live.some((c) => isHand(c))) return 'hands';
    if (!settings.controllerIntroSeen && live.some((c) => !isHand(c))) return 'controllers';
    return null;
}
