import { describe, expect, it } from 'vitest';
import { introToShow } from '../src/scene/intro.js';

const hand = { userData: { inputSource: { hand: {} } } };
const pad = { userData: { inputSource: { gamepad: {} } } };
const gone = { userData: {} };
const isHand = (c) => !!c.userData.inputSource.hand;

describe('introToShow', () => {
    it('hands only → the hand intro, once', () => {
        expect(introToShow([hand], {}, isHand)).toBe('hands');
        expect(introToShow([hand], { handIntroSeen: true }, isHand)).toBeNull();
    });

    it('controllers only → the controller intro, once', () => {
        expect(introToShow([pad, pad], {}, isHand)).toBe('controllers');
        expect(introToShow([pad], { controllerIntroSeen: true }, isHand)).toBeNull();
    });

    it('both → hands first, then controllers', () => {
        expect(introToShow([hand, pad], {}, isHand)).toBe('hands');
        expect(introToShow([hand, pad], { handIntroSeen: true }, isHand)).toBe('controllers');
        expect(introToShow([hand, pad], { handIntroSeen: true, controllerIntroSeen: true }, isHand)).toBeNull();
    });

    it('ignores disconnected slots', () => {
        expect(introToShow([gone, gone], {}, isHand)).toBeNull();
        expect(introToShow([gone, pad], {}, isHand)).toBe('controllers');
    });
});
