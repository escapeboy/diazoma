/** Longest `re` a recipe may carry, and the longest string it is run on. */
export const MAX_RE_LENGTH = 200;
export const MAX_RE_INPUT = 256;
/**
 * Variable parts a pattern may hold: one, or two when it starts with `^` and has no top-level `|`. Every
 * further part multiplies the work by up to n, so this keeps it quadratic: far under 50 ms at MAX_RE_INPUT.
 */
const MAX_VARIABLE = 2;

interface Group {
    quant: boolean;
    alt: boolean;
    pipe: boolean;
}

/**
 * Why a recipe's regular expression is refused, or null when it may run. The engine backtracks, so
 * a pattern that can take super-linear time on a crafted string is turned away up front: a backreference,
 * a repeated group that holds a quantifier or an alternation (`(a+)+`, `(a|b)*`), and more than two
 * variable parts (one, or two when anchored). A variable part is a quantifier whose count can differ (`*`, `+`,
 * `?`, `{m,}`, `{m,n}` with n > m, bounded or not) or a group with an alternation; `{3}` and `{2,2}` do not count.
 */
export function checkRegex(re: string): string | null {
    if (re.length > MAX_RE_LENGTH) return `longer than ${MAX_RE_LENGTH} characters`;
    const stack: Group[] = [{ quant: false, alt: false, pipe: false }];
    let last: Group | null = null;
    let variable = 0;
    let topPipe = false;
    let i = 0;
    while (i < re.length) {
        const c = re[i];
        const top = stack[stack.length - 1];
        if (c === '\\') {
            const n = re[i + 1];
            if ((n >= '1' && n <= '9') || n === 'k') return 'backreference';
            last = null;
            i += 2;
            continue;
        }
        if (c === '[') {
            i++;
            while (i < re.length && re[i] !== ']') i += re[i] === '\\' ? 2 : 1;
            last = null;
            i++;
            continue;
        }
        if (c === '(') {
            stack.push({ quant: false, alt: false, pipe: false });
            i++;
            if (re[i] === '?') {
                i++;
                if (re[i] === '<' && re[i + 1] !== '=' && re[i + 1] !== '!') i = re.indexOf('>', i) < 0 ? re.length : re.indexOf('>', i) + 1;
                else i += re[i] === '<' ? 2 : 1;
            }
            last = null;
            continue;
        }
        if (c === ')') {
            if (stack.length === 1) return 'unbalanced parenthesis';
            last = stack.pop()!;
            const parent = stack[stack.length - 1];
            parent.quant ||= last.quant;
            parent.alt ||= last.alt;
            i++;
            continue;
        }
        if (c === '|') {
            top.alt = true;
            if (stack.length === 1) topPipe = true;
            if (!top.pipe && ++variable > MAX_VARIABLE) return `more than ${MAX_VARIABLE} variable quantifiers or alternations`;
            top.pipe = true;
            last = null;
            i++;
            continue;
        }
        let repeats = false;
        let vary = false;
        let len = 0;
        if (c === '*' || c === '+') {
            repeats = true;
            vary = true;
            len = 1;
        } else if (c === '?') {
            vary = true;
            len = 1;
        } else if (c === '{') {
            const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(re.slice(i));
            if (m) {
                len = m[0].length;
                const max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : Number(m[1]);
                vary = max > Number(m[1]);
                repeats = max > 1;
            }
        }
        if (len) {
            if (repeats && last && (last.quant || last.alt)) return 'a repeated group that holds a quantifier or an alternation';
            top.quant = true;
            if (vary && ++variable > MAX_VARIABLE) return `more than ${MAX_VARIABLE} variable quantifiers or alternations`;
            i += len;
            if (re[i] === '?' || re[i] === '+') i++;
            last = null;
            continue;
        }
        last = null;
        i++;
    }
    if (stack.length > 1) return 'unbalanced parenthesis';
    if (variable > 1 && (re[0] !== '^' || topPipe)) return 'more than 1 variable quantifier or alternation in a pattern that does not start with ^';
    return null;
}
