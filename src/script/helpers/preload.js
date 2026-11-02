const WARM_HOLD = 8000;
const LEAVE_HOLD = 1500;
const USED_HOLD = 60000;

const entries = new Map();

const Hold = (function(tab, entry, ms) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
        if (entries.get(tab) === entry) entries.delete(tab);
    }, ms);
});

const Get = (function(tab, results, load) {
    let entry = entries.get(tab);
    if (entry?.results === results) return entry;

    if (entry) clearTimeout(entry.timer);
    entry = { results, used: false, timer: 0 };
    entry.promise = Promise.resolve().then(load).catch(error => {
        clearTimeout(entry.timer);
        if (entries.get(tab) === entry) entries.delete(tab);
        throw error;
    });
    entries.set(tab, entry);
    return entry;
});

export const Preloaded = (function(tab, results, load) {
    const entry = Get(tab, results, load);
    entry.used = true;
    Hold(tab, entry, USED_HOLD);
    return entry.promise;
});

export const Warm = (function(tab, results, load) {
    const entry = Get(tab, results, load);
    if (!entry.used) Hold(tab, entry, WARM_HOLD);
    return entry.promise;
});

export const Release = (function(tab) {
    const entry = entries.get(tab);
    if (entry && !entry.used) Hold(tab, entry, LEAVE_HOLD);
});

export const ClearPreloads = (function() {
    for (const entry of entries.values()) clearTimeout(entry.timer);
    entries.clear();
});
