import { runEmbed } from './embed.js';

// document.currentScript is only set while the script runs, so read it before anything is awaited.
const tag = document.currentScript;
if (tag) void runEmbed(tag, { document, window, pageUrl: location.href });
else console.error('diazoma-embed: must be loaded with a plain <script src> tag');
