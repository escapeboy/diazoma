/**
 * Natural-hand pose from finger ratios (tip-to-wrist / knuckle-to-wrist for index, middle,
 * ring, pinky) and the thumb–index gap in metres (null when unknown).
 *
 * Tuned on 3,096 real Quest 2 samples (xr_hand_sample, 2026-09-27): pointing put the index
 * at 1.58 at its 5th percentile, so 1.55 made ~5 % of pointing frames flicker to 'claw'
 * and restart the dwell; a fist's thumb–index gap was 2.8 cm at its 5th percentile, 3 mm
 * above the old 2.5 cm cut, so fists under zoom read as 'claw'. Replaying the samples with
 * 1.50 / 2.0 cm moves 24 claw→point, 18 claw→fist (14 during a held fist or zoom, 4
 * outside one) and 72 loose→open (same behaviour), nothing else. The samples' timestamps
 * are batched, so frame order (e.g. point,claw,point flicker) cannot be shown from them.
 */
export const FINGER_CURLED = 1.25; // below this = finger curled
export const FINGER_EXTENDED = 1.5; // above this = finger extended
export const FINGER_RELEASE = 1.4; // a fist ends once two fingers open past this (a relaxed hand, not only a flat one)
export const FIST_MIN_GAP = 0.02; // a real fist has the thumb over the fingers, not on the index tip

export const HAND_THRESHOLDS = { curled: FINGER_CURLED, extended: FINGER_EXTENDED, release: FINGER_RELEASE, fistMinGap: FIST_MIN_GAP };

/** @returns {'fist'|'point'|'claw'|'open'|'loose'|'other'} */
export function classifyHand(r, gap, t = HAND_THRESHOLDS) {
    const curled = r.map((x) => x < t.curled);
    const extended = r.map((x) => x > t.extended);
    // Closing thumb onto index often curls the index too; that is a zoom-out, not a fist.
    if (curled.every(Boolean) && (gap === null || gap > t.fistMinGap)) return 'fist';
    if (extended[0] && curled[1] && curled[2]) return 'point';
    if (curled[1] && curled[2]) return 'claw'; // index half-bent towards the thumb
    if (extended.every(Boolean)) return 'open';
    if (r.filter((x) => x > t.release).length >= 2) return 'loose';
    return 'other';
}
