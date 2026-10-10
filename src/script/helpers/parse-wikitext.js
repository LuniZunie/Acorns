const CAT = Uint8Array.from("[[category:", ch => ch.charCodeAt(0));
const HTTP = Uint8Array.from("http", ch => ch.charCodeAt(0));
const IMG = [
    Uint8Array.from("[[file:", ch => ch.charCodeAt(0)),
    Uint8Array.from("[[image:", ch => ch.charCodeAt(0)),
    Uint8Array.from("[[media:", ch => ch.charCodeAt(0)),
];

// Link terminators (ASCII): whitespace + [ ] < > " ' | { } $
const LT = new Uint8Array(128);
for (const ch of " \t\n\v\f\r[]<>\"'|{}`\\^") LT[ch.charCodeAt(0)] = 1;

// Stop characters for the backwards "name=file.ext" scan
const STOP = new Uint8Array(128);
for (const ch of "\n[]{}\\/<>#|:") STOP[ch.charCodeAt(0)] = 1;

// chars worth a closer look
const SK = new Uint8Array(105);
SK[91] = SK[46] = SK[104] = SK[72] = 1;   // [ . h H

const IMG_LEN = [ 7, 9, 8 ];

// JS String.prototype.trim() whitespace
const IsWs = c =>
    c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
    c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;

// trim + "_" -> " " with a single slice
const Clean = (s, a, b) => {
    while (a < b && IsWs(s.charCodeAt(a))) a++;
    while (b > a && IsWs(s.charCodeAt(b - 1))) b--;
    const r = s.slice(a, b);
    return r.indexOf("_") < 0 ? r : r.replaceAll("_", " ");
};

// accepted extensions starting at p (4 or 5), or 0.
// 4: tif png gif jpg xcf pdf mid ogg ogv oga svg wav mp3 mpg
// 5: tiff jpeg webp midi djvu flac opus webm mpeg
const ExtLen = (s, p) => {
    const c2 = s.charCodeAt(p + 2), c3 = s.charCodeAt(p + 3);
    switch (s.charCodeAt(p + 1)) {
        case 116: // t: tif tiff
            return c2 === 105 && c3 === 102 ? (s.charCodeAt(p + 4) === 102 ? 5 : 4) : 0;
        case 112: // p: png pdf
            return (c2 === 110 && c3 === 103) || (c2 === 100 && c3 === 102) ? 4 : 0;
        case 103: // g: gif
            return c2 === 105 && c3 === 102 ? 4 : 0;
        case 106: // j: jpg jpeg
            if (c2 !== 112) return 0;
            if (c3 === 103) return 4;
            return c3 === 101 && s.charCodeAt(p + 4) === 103 ? 5 : 0;
        case 120: // x: xcf
            return c2 === 99 && c3 === 102 ? 4 : 0;
        case 111: // o: ogg ogv oga opus
            if (c2 === 103) return c3 === 103 || c3 === 118 || c3 === 97 ? 4 : 0;
            return c2 === 112 && c3 === 117 && s.charCodeAt(p + 4) === 115 ? 5 : 0;
        case 115: // s: svg
            return c2 === 118 && c3 === 103 ? 4 : 0;
        case 119: { // w: wav webp webm
            if (c2 === 97) return c3 === 118 ? 4 : 0;
            if (c2 === 101 && c3 === 98) {
                const c4 = s.charCodeAt(p + 4);
                return c4 === 112 || c4 === 109 ? 5 : 0;
            }
            return 0;
        }
        case 109: { // m: mp3 mpg mpeg mid midi
            if (c2 === 112) {
                if (c3 === 51 || c3 === 103) return 4;
                return c3 === 101 && s.charCodeAt(p + 4) === 103 ? 5 : 0;
            }
            if (c2 === 105 && c3 === 100) return s.charCodeAt(p + 4) === 105 ? 5 : 4;
            return 0;
        }
        case 100: // d: djvu
            return c2 === 106 && c3 === 118 && s.charCodeAt(p + 4) === 117 ? 5 : 0;
        case 102: // f: flac
            return c2 === 108 && c3 === 97 && s.charCodeAt(p + 4) === 99 ? 5 : 0;
    }
    return 0;
};

export const ParseWikitext = (s, wt) => {
    if (typeof s !== "string")
        return { c: [ ], i: [ ], l: [ ], d: true };

    if (!wt) { // contentmodel is not wikitext, only search for cats (meow!)
        const n = s.length, cats = [ ];

        let p = s.indexOf("[[");
        while (p >= 0) {
            let r = p + 2;
            while (s.charCodeAt(r) === 91) r++;          // "[[[category:" still matches, as before
            // case-insensitive "category:" (c|32 folds A-Z to a-z; NaN|32 never matches)
            if ((s.charCodeAt(r)     | 32) ===  99 && (s.charCodeAt(r + 1) | 32) ===  97 &&
                (s.charCodeAt(r + 2) | 32) === 116 && (s.charCodeAt(r + 3) | 32) === 101 &&
                (s.charCodeAt(r + 4) | 32) === 103 && (s.charCodeAt(r + 5) | 32) === 111 &&
                (s.charCodeAt(r + 6) | 32) === 114 && (s.charCodeAt(r + 7) | 32) === 121 &&
                s.charCodeAt(r + 8) === 58) {
                const a = r + 9;
                let q = a;
                for (; q < n; q++) {
                    const c = s.charCodeAt(q);
                    if (c === 93 || c === 124) { cats.push(Clean(s, a, q)); break; }
                    if (c === 10) break;                  // newline aborts, no push
                }
                if (q >= n) break;                        // unterminated at EOF: discarded, as before
                p = s.indexOf("[[", q + 1);
            } else p = s.indexOf("[[", r);                // r is never '[', so nothing is skipped
        }
        return { c: cats, i: [ ], l: [ ], d: true };
    }

    const n = s.length;
    const cats = [ ], imgs = [ ], lnks = [ ];

    // per-scanner state: mode (0 = matching, 1 = collecting), match progress, text start
    let cm = 0, ci = 0, cs = 0;
    let im = 0, ii = 0, iv = 0, is = 0;
    let lm = 0, li = 0, ls = 0, lb = 0; // ls = start of URL (incl. scheme), lb = first char after scheme

    for (let p = 0; p < n; p++) {
        // Idle fast path: nothing in progress, so only '[' 'h' 'H' '.' can start anything.
        if ((cm | im | lm | ci | ii | li) === 0) {
            for (; p < n; p++) {
                const d = s.charCodeAt(p);
                if (d > 104 || SK[d] === 0) continue;                 // most chars rejected here
                if (d === 91) { if (s.charCodeAt(p + 1) === 91) break; }       // only "[[" can start cat/file
                else if (d === 104 || d === 72) {                              // only "ht" can start a link
                    const e = s.charCodeAt(p + 1);
                    if (e === 116 || e === 84) break;
                }
                else if (ExtLen(s, p) !== 0) break;                            // only a real ".ext"
            }
            if (p >= n) break;
        }

        const c = s.charCodeAt(p);
        const lc = (c > 64 && c < 91) ? c + 32 : c; // ASCII lowercase

        // ---- "name=file.ext" ----
        if (c === 46) {
            const L = ExtLen(s, p);
            if (L !== 0) {
                for (let j = p - 1; j >= 0; j--) {
                    const d = s.charCodeAt(j);
                    if (d === 61) { imgs.push(s.slice(j + 1, p + L)); break; }
                    if (d < 128 && STOP[d] === 1) break;
                }
            }
        }

        // ---- [[category: ----
        if (cm === 0) {
            if (lc === CAT[ci]) { if (++ci === 11) { ci = 0; cm = 1; cs = p + 1; } }
            else ci = lc === 91 ? (ci === 2 ? 2 : 1) : 0;
        } else if (c === 10) cm = 0;
        else if (c === 93 || c === 124) { cats.push(Clean(s, cs, p)); cm = 0; }

        // ---- [[file: / [[image: / [[media: ----
        if (im === 0) {
            if (ii < 2) {
                if (lc === 91) ii++; else ii = 0;
            } else if (ii === 2) {
                if (lc === 102) { iv = 0; ii = 3; }
                else if (lc === 105) { iv = 1; ii = 3; }
                else if (lc === 109) { iv = 2; ii = 3; }
                else ii = lc === 91 ? 2 : 0;
            } else {
                const w = IMG[iv];
                const ix = ii;
                if (lc === w[ix]) { if (++ii === IMG_LEN[iv]) { ii = 0; im = 1; is = p + 1; } }
                else ii = lc === 91 ? 1 : 0;
            }
        } else if (c === 10) im = 0;
        else if (c === 93 || c === 124) { imgs.push(Clean(s, is, p)); im = 0; }

        // ---- http:// / https:// ----
        if (lm === 0) {
            let nx;
            if (li < 4) nx = lc === HTTP[li] ? li + 1 : -1;
            else if (li === 4) nx = lc === 58 ? 5 : lc === 115 ? 7 : -1; // ':' or 's'
            else if (li === 7) nx = lc === 58 ? 5 : -1;                  // https ':'
            else if (li === 5) nx = lc === 47 ? 6 : -1;                  // first '/'
            else nx = lc === 47 ? 8 : -1;                                // second '/'

            if (nx === 8) { li = 0; lm = 1; lb = p + 1; }
            else if (nx < 0) { if (lc === 104) { li = 1; ls = p; } else li = 0; }
            else { if (li === 0) ls = p; li = nx; }
        } else if (c < 128 ? LT[c] === 1 : IsWs(c)) {
            if (p > lb) lnks.push(s.slice(ls, p));
            lm = 0;
        }
    }

    // a URL running to end of input is still a URL
    if (lm === 1 && n > lb) lnks.push(s.slice(ls, n));

    return { c: cats, i: imgs, l: lnks, d: true };
};