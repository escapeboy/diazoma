import { describe, expect, it } from 'vitest';
import { KEY, canSubmit, createState, press, rows } from '../src/scene/keyboard.js';

const type = (state, keys) => keys.reduce((s, k) => press(s, k), state);

describe('VR keyboard', () => {
    it('types, spaces and deletes', () => {
        const s = type(createState(), ['b', 'e', 'a', KEY.SPACE, KEY.SPACE, 'x', KEY.BACKSPACE, 'c', 'h']);
        expect(s.text).toBe('bea ch');
    });

    it('never starts with a space', () => {
        expect(type(createState(), [KEY.SPACE, 'a']).text).toBe('a');
    });

    it('shift is one-shot and shows upper-case keys', () => {
        let s = press(createState(), KEY.SHIFT);
        expect(rows(s)[1][0]).toBe('Q');
        s = type(s, ['q', 'q']);
        expect(s.text).toBe('Qq');
        expect(rows(s)[1][0]).toBe('q');
    });

    it('capitalises the first letter of a board name, again after clearing it', () => {
        let s = type(createState({ capitalize: true }), ['b', 'e']);
        expect(s.text).toBe('Be');
        s = type(s, [KEY.BACKSPACE, KEY.BACKSPACE, 'n']);
        expect(s.text).toBe('N');
    });

    it('switches to the Bulgarian phonetic layout and back', () => {
        let s = press(createState(), KEY.LAYOUT);
        expect(rows(s)[1].join('')).toBe('явертъуиоп');
        s = type(s, ['п', 'л', 'а', 'ж']);
        expect(s.text).toBe('плаж');
        expect(press(s, KEY.LAYOUT).layout).toBe('latin');
    });

    it('stops at the length limit, counting Cyrillic as one character each', () => {
        const s = type(createState({ maxLength: 3, layout: 'cyrillic' }), ['ж', 'ж', 'ж', 'ж']);
        expect(s.text).toBe('жжж');
    });

    it('submits only non-empty text; cancel always closes', () => {
        expect(press(createState(), KEY.SUBMIT).done).toBeNull();
        expect(press(createState({ text: 'x' }), KEY.SUBMIT).done).toBe('submit');
        expect(press(createState({ text: 'x' }), KEY.CANCEL).done).toBe('cancel');
    });

    it('canSubmit: empty, too short (in characters), busy, ok', () => {
        expect(canSubmit(createState())).toBe('empty');
        expect(canSubmit(createState({ text: '  ' }))).toBe('empty');
        expect(canSubmit(createState({ text: 'аб' }), { minLength: 3 })).toBe('too_short');
        expect(canSubmit(createState({ text: 'абв' }), { minLength: 3 })).toBe('ok');
        expect(canSubmit(createState({ text: 'абв' }), { minLength: 3, submitting: true })).toBe('busy');
    });
});
