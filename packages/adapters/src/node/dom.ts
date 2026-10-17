import { DOMParser as LinkedomParser } from 'linkedom';

/** Adapters use the global DOMParser, as in a browser; in Node this installs linkedom's. */
export function installDom(): void {
    if (typeof globalThis.DOMParser === 'undefined') (globalThis as { DOMParser: unknown }).DOMParser = LinkedomParser;
}
