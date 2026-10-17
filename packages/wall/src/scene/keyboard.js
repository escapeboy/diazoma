/**
 * Text entry inside VR (search, new board name) — layout and editing only, no three.js.
 * Two layouts: Latin QWERTY and Bulgarian phonetic (the layout Bulgarian phones and
 * desktops default to), so every locale the site ships can type its own words.
 */
export const LAYOUTS = {
    latin: ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm-'],
    cyrillic: ['1234567890', 'явертъуиоп', 'асдфгхйклш', 'зьцжбнмщчю'],
};

export const KEY = { SHIFT: '⇧', BACKSPACE: '⌫', SPACE: 'space', LAYOUT: 'layout', SUBMIT: 'submit', CANCEL: 'cancel' };

export function createState({ text = '', layout = 'latin', maxLength = 100, capitalize = false } = {}) {
    return { text: String(text).slice(0, maxLength), layout: LAYOUTS[layout] ? layout : 'latin', shift: capitalize && !text, maxLength, capitalize };
}

/** The rows of character keys as currently shown (upper case while shift is on). */
export function rows(state) {
    return LAYOUTS[state.layout].map((row) => [...row].map((ch) => (state.shift ? ch.toUpperCase() : ch)));
}

/**
 * Applies one key press. Returns the new state; `done` is 'submit' or 'cancel' when the
 * panel should close. Shift is one-shot, like a phone keyboard.
 */
export function press(state, key) {
    const s = { ...state };
    switch (key) {
        case KEY.SHIFT: s.shift = !s.shift; return s;
        case KEY.LAYOUT: s.layout = s.layout === 'latin' ? 'cyrillic' : 'latin'; return s;
        case KEY.BACKSPACE: s.text = [...s.text].slice(0, -1).join(''); s.shift = s.capitalize && s.text === ''; return s;
        case KEY.SPACE: key = ' '; break;
        case KEY.SUBMIT: return { ...s, done: s.text.trim() === '' ? null : 'submit' };
        case KEY.CANCEL: return { ...s, done: 'cancel' };
        default: break;
    }
    if ([...s.text].length >= s.maxLength) return s;
    // No leading or double spaces (search and board names never need them).
    if (key === ' ' && (s.text === '' || s.text.endsWith(' '))) return s;
    s.text += s.shift ? key.toUpperCase() : key;
    s.shift = false;
    return s;
}

/**
 * Whether ✓ may send: 'ok', 'empty', 'too_short' (show a hint) or 'busy' (a previous
 * submit is still in flight). Length is counted in characters, after trimming.
 */
export function canSubmit(state, { minLength = 1, submitting = false } = {}) {
    if (submitting) return 'busy';
    const text = state.text.trim();
    if (text === '') return 'empty';
    return [...text].length < minLength ? 'too_short' : 'ok';
}
