import type { InputProfile, ProfileName } from '../types';

// One-hand push/pull zoom: grab (fist, pinch or trigger) and pull the hand towards you to zoom
// in, push it away to zoom out. Follows the whole hand's distance from the head (10-25 cm of
// travel, tracked far more steadily than finger gaps), absolute from where the pull started.
const quest: InputProfile = {
    name: 'meta-quest',
    thumbDeadzone: 0.15,
    thumbSpeed: 1.4, // rad/s at full deflection
    dragPxToRad: 0.0032,
    pressDragThreshold: 0.035, // rad of controller travel before a trigger press becomes a drag
    pressDragThresholdHand: 0.07, // pinches jitter more than a trigger; a tap must stay a tap
    swipeRad: 0.12, // horizontal sweep in the viewer that steps to the next/previous item
    emptyHold: 1.0, // seconds a pinch/trigger held on empty space takes to hide everything
    fistHideHold: 2.0, // natural hands: a resting hand curls into a fist, so a still fist hides only after this long
    dwellSelect: 0.8, // natural hand mode: seconds of pointing at one thing to select it
    dwellRearmRad: 0.08, // after a dwell select, the finger must move this far before the next one
    dwellSteps: 24, // ring segments; the fill advances one segment at a time
    pullZoomGain: Math.log(2.5) / 0.2, // 20 cm of pull ≈ 2.5×
    pullThreshold: 0.04, // metres of push/pull before a press becomes a zoom
    zoomStep: 1.25, // the viewer's − / + buttons
    zoomRepeat: 0.35, // natural hands: a finger kept on − / + repeats the step this often
    fistHold: 0.15, // a fist must hold this long before it grabs (a closing pinch passes through 'fist' briefly)
    handDebugInterval: 0.25, // seconds between diagnostic samples/overlay refreshes
    zoomMin: 0.7,
    zoomMax: 4,
    btnPrimary: 4, // xr-standard gamepad: A / X
    btnSecondary: 5, // B / Y
    holdToOpen: 0.6, // seconds A must be held to leave VR for the item page
    confirmWindow: 3, // seconds an armed "tap again to confirm" button waits for the second select
    handRestDrop: 0.5, // auto active hand: a hand this far below the eyes is resting (lap, side)…
    handWakeDrop: 0.42, // …and works again once raised above this (hysteresis, no flicker)
    hideHold: 0.8, // seconds both grips must be held to hide everything
    hoverPlayDelay: 0.5, // seconds of pointing before a GIF/video card starts playing
    // Finger-ratio classification of a natural hand (handPose.js).
    hand: { curled: 1.25, extended: 1.5, release: 1.4, fistMinGap: 0.02 },
};

const copy = (name: string, over: Partial<InputProfile> = {}): InputProfile => ({ ...quest, hand: { ...quest.hand }, ...over, name });

export const profiles: Record<ProfileName, InputProfile> = {
    'meta-quest': quest,
    // Spec 01 §1.4 proposes 0.09 for Pico hands; that is "to be measured", so P0 keeps the Quest values.
    pico: copy('pico'),
    'android-xr': copy('android-xr'),
    visionos: copy('visionos', { mode: 'transient-pointer', dwellSelect: 0 }),
    desktop: copy('desktop'),
    phone: copy('phone'),
};

export interface PickEnv {
    ua?: string;
    /** `inputSource.profiles` of the first input source of a session. */
    inputProfiles?: string[];
}

/** Picks a profile by name, or ('auto') by the session's input profile ids, falling back to the UA family. */
export function pickProfile(choice: ProfileName | 'auto' = 'auto', env: PickEnv = {}): InputProfile {
    if (choice !== 'auto') return profiles[choice] || quest;
    const ids = (env.inputProfiles || []).join(' ').toLowerCase();
    if (/oculus|meta-quest|quest/.test(ids)) return profiles['meta-quest'];
    if (/pico/.test(ids)) return profiles.pico;
    const ua = env.ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
    if (/OculusBrowser|Quest/i.test(ua)) return profiles['meta-quest'];
    if (/PicoBrowser|Pico\b/i.test(ua)) return profiles.pico;
    if (/Android.*\bXR\b|AndroidXR/i.test(ua)) return profiles['android-xr'];
    if (/Vision ?Pro|visionOS/i.test(ua)) return profiles.visionos;
    if (/Android|iPhone|iPad|Mobile/i.test(ua)) return profiles.phone;
    return profiles.desktop;
}
