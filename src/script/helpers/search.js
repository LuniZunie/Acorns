const SEPARATORS = /[\s\-_.,;:/\\|()[\]{}]+/;
const SEPARATORS_GLOBAL = new RegExp(SEPARATORS.source, "g");

const AllowedErrors = (function(len) { return len <= 2 ? 0 : len <= 4 ? 1 : len <= 8 ? 2 : 3; });
const Tokenize = (function(text) { return text.split(SEPARATORS).filter(Boolean) });
const Normalize = (function(text) {
    return String(text ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
});

const PrefixDistance = (function(query, word, max) {
    const m = query.length, n = word.length;
    let prev = Array.from({ length: n + 1 }, (_, i) => i), prev2 = null;
    for (let i = 1; i <= m; i++) {
        const cur = [ i];
        let rowMin = i;
        for (let j = 1; j <= n; j++) {
            const cost = query[i - 1] === word[j - 1] ? 0 : 1;
            let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);

            const transposed = i > 1 && j > 1 && query[i - 1] === word[j - 2] && query[i - 2] === word[j - 1];
            if (transposed) value = Math.min(value, prev2[j - 2] + 1);

            cur[j] = value;
            rowMin = Math.min(rowMin, value);
        }

        if (rowMin > max) return Infinity;
        [ prev2, prev] = [ prev, cur];
    }

    return Math.min(...prev);
});

const ScoreToken = (function(token, word) {
    const len = token.length;
    if (word === token) return 0;
    if (word.startsWith(token)) return 0.1 + 0.4 * (1 - len / word.length);
    if (len >= 2 && word.includes(token)) return 1;
    if (len < 3) return Infinity;

    const max = AllowedErrors(len);
    const d = PrefixDistance(token, word, max);
    return d <= max ? 1.5 + d : Infinity;
});

const ScoreItem = (function(item, query, tokens, compactQuery) {
    const { text } = item;
    const len = text.length;

    if (text === query) return 0;
    if (text.startsWith(query))
        return 1 + (len - query.length) / (len + 1);

    const position = text.indexOf(query);
    if (position !== -1) {
        const atWordStart = SEPARATORS.test(text[position - 1]);
        return (atWordStart ? 2 : 3) + position / (len + 1);
    }

    if (compactQuery.length >= 3) {
        const compactPosition = item.compact.indexOf(compactQuery);
        if (compactPosition !== -1)
            return 3.5 + compactPosition / (item.compact.length + 1);
    }

    if (!tokens.length) return Infinity;

    const used = new Set();
    let total = 0;
    for (const token of tokens) {
        let best = Infinity, bestIndex = -1;
        item.words.forEach((word, i) => {
            if (used.has(i)) return;
            const s = ScoreToken(token, word);
            if (s < best) [ best, bestIndex] = [ s, i];
        });

        if (best === Infinity) return Infinity;
        used.add(bestIndex);
        total += best;
    }

    return 4 + total / tokens.length;
});

export const ScoreSearch = (function(search, values = [ ], getText = (v => v)) {
    const items = [ ];
    const seen = new Set();

    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);

        const text = Normalize(getText(value));
        if (!text) continue;

        items.push({
            value,
            text,
            compact: text.replace(SEPARATORS_GLOBAL, ""),
            words: Tokenize(text),
            index: items.length
        });
    }

    const query = Normalize(search);
    if (!query) return items.map(item => item.value);

    const tokens = Tokenize(query);
    const compactQuery = tokens.join("");

    return items
        .map(item => ({ item, score: ScoreItem(item, query, tokens, compactQuery) }))
        .filter(r => r.score !== Infinity)
        .sort((a, b) =>
            a.score - b.score ||
            a.item.text.length - b.item.text.length ||
            a.item.index - b.item.index
        )
        .map(r => r.item.value);
});