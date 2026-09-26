'use strict';

// Decode HTML source text once, before displaying it in native text controls.
// JSON bidder names are already plain text and must not be decoded again.
const NAMED = Object.freeze({
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0',
  middot: '·', ndash: '–', mdash: '—', hellip: '…',
});

function decodeHtmlEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    if (body[0] !== '#') return NAMED[body] ?? entity;
    const hex = body[1].toLowerCase() === 'x';
    const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(code);
  });
}

module.exports = { decodeHtmlEntities };
