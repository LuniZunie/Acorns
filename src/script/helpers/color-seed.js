const CANDIDATE_COUNT = 100;

const cache = new Map();
self.seed = 0;

const mix32 = (function(n) {
    n ^= n >>> 16;
    n = Math.imul(n, 0x85ebca6b);
    n ^= n >>> 13;
    n = Math.imul(n, 0xc2b2ae35);
    n ^= n >>> 16;
    return n >>> 0;
});

const GetPaletteDistance = (function(array, seed) {
    const len = array.length, hues = [ ];
    for (let i = 0; i < len; i++)
        hues.push(Number(SeededColor(array[i], seed).match(/^hsl\((\d+)/)[1]));

    let min = Infinity;
    for (let i = 0; i < len; i++)
        for (let j = i + 1; j < len; j++) {
            const diff = Math.abs(hues[i] - hues[j]);
            min = Math.min(min, diff, 360 - diff);
        }

    return min;
});

const StateColorSeed = (function() {
    const state = history.state ?? { };
    if (state.seed !== self.seed) {
        cache.clear();
        state.seed = self.seed;
        history.replaceState(state, "");
    }
});

export const GetColorSeed = (function() { return self.seed; });
export const SetColorSeed = (function(seed) {
    const temp = Number.parseInt(seed, 10) || 0;
    if (temp !== self.seed) {
        self.seed = temp;
        StateColorSeed();
    }
});
export const PickColorSeed = (function(iterator) {
    const array = Array.from(iterator);

    const currentSeed = self.seed;
    const candidates = new Set();
    while (candidates.size < CANDIDATE_COUNT) {
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        if (seed !== currentSeed) candidates.add(seed);
    }

    let best, greatest = -Infinity;
    for (const candidate of candidates) {
        const distance = GetPaletteDistance(array, candidate);
        if (distance > greatest) {
            best = candidate;
            greatest = distance;
        }
    }

    self.seed = best;
    StateColorSeed();
});

export const SeededColor = (function(str, seed = self.seed) {
    seed = Number(seed) >>> 0;
    if (cache.has(str)) return cache.get(str);

    let hash = (2166136261 ^ mix32(seed ^ 0x9e3779b9)) >>> 0;
    const len = str.length;
    for (let i = 0; i < len; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    hash = mix32(hash ^ mix32(seed + len));

    const hue = hash % 360;
    const saturation = 46 + (mix32(hash ^ 0x243f6a88) % 20);
    const lightness = 66 + (mix32(hash ^ 0xb7e15162) % 13);

    const temp = `hsl(${hue} ${saturation}% ${lightness}%)`;
    cache.set(str, temp);
    return temp;
});