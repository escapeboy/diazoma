import { installDom } from '../src/node/dom';

// The adapters use the global DOMParser, as in a browser. In tests that is linkedom's.
installDom();
