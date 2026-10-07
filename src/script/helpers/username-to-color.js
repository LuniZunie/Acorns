function mix32(value) {
    value ^= value >>> 16;
    value = Math.imul(value, 0x85ebca6b);
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2ae35);
    value ^= value >>> 16;
    return value >>> 0;
}

export function SetUserColorSeed(seed) {
    self.seed = parseInt(seed, 10) || 0;
}

export function StateUserColorSeed() {
    const state = window.history.state ?? { };
    state.seed = self.seed;
    window.history.replaceState(state, "");
}

export function UserColor(username, seed = self.seed ?? 0) {
    const normalizedSeed = Number(seed) >>> 0;
    let hash = (2166136261 ^ mix32(normalizedSeed ^ 0x9e3779b9)) >>> 0;

    for (let i = 0; i < username.length; i++) {
        hash ^= username.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    hash = mix32(hash ^ mix32(normalizedSeed + username.length));

    const hue = hash % 360;
    const saturation = 46 + (mix32(hash ^ 0x243f6a88) % 20);
    const lightness = 66 + (mix32(hash ^ 0xb7e15162) % 13);

    return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function GetUserColorSeed() { return self.seed || 0; }