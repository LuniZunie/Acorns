const SEPARATORS = /[\s_.\-/]+/;
const SEPARATORS_GLOBAL = new RegExp(SEPARATORS.source, "g");

const normalize = text =>
    String(text ?? "")
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "") // strip accents
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

const tokenize = text => text.split(SEPARATORS).filter(Boolean);
const allowedErrors = length => (length <= 2 ? 0 : length <= 4 ? 1 : length <= 8 ? 2 : 3);

/** Damerau-Levenshtein distance between `query` and the closest prefix of `word`. */
function prefixDistance(query, word, max) {
    const m = query.length, n = word.length;
    let prev2 = null;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);

    for (let i = 1; i <= m; i++) {
        const cur = [i];
        let rowMin = i;

        for (let j = 1; j <= n; j++) {
            const cost = query[i - 1] === word[j - 1] ? 0 : 1;
            let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);

            const transposed = i > 1 && j > 1 &&
                query[i - 1] === word[j - 2] && query[i - 2] === word[j - 1];
            if (transposed) value = Math.min(value, prev2[j - 2] + 1);

            cur[j] = value;
            rowMin = Math.min(rowMin, value);
        }

        if (rowMin > max) return Infinity;
        [prev2, prev] = [prev, cur];
    }

    return Math.min(...prev);
}

function scoreToken(token, word) {
    if (word === token) return 0;
    if (word.startsWith(token)) return 0.1 + 0.4 * (1 - token.length / word.length);
    if (token.length >= 2 && word.includes(token)) return 1;
    if (token.length < 3) return Infinity;

    const max = allowedErrors(token.length);
    const d = prefixDistance(token, word, max);
    return d <= max ? 1.5 + d : Infinity;
}

function scoreItem(item, query, tokens, compactQuery) {
    const { text } = item;

    if (text === query) return 0;
    if (text.startsWith(query))
        return 1 + (text.length - query.length) / (text.length + 1);

    const position = text.indexOf(query);
    if (position !== -1) {
        const atWordStart = SEPARATORS.test(text[position - 1]);
        return (atWordStart ? 2 : 3) + position / (text.length + 1);
    }

    if (compactQuery.length >= 3) {
        const compactPosition = item.compact.indexOf(compactQuery);
        if (compactPosition !== -1)
            return 3.5 + compactPosition / (item.compact.length + 1);
    }

    if (!tokens.length) return Infinity;

    // Match every query token to a distinct word of the item.
    const used = new Set();
    let total = 0;
    for (const token of tokens) {
        let best = Infinity, bestIndex = -1;
        item.words.forEach((word, i) => {
            if (used.has(i)) return;
            const s = scoreToken(token, word);
            if (s < best) [best, bestIndex] = [s, i];
        });

        if (best === Infinity) return Infinity;
        used.add(bestIndex);
        total += best;
    }

    return 4 + total / tokens.length;
}

function createSuggestionSearch(suggestions = [], defaultLimit = 10) {
    const items = [];
    const seen = new Set();

    for (const value of suggestions) {
        if (seen.has(value)) continue;
        seen.add(value);

        const text = normalize(value);
        if (!text) continue;

        items.push({
            value,
            text,
            compact: text.replace(SEPARATORS_GLOBAL, ""),
            words: tokenize(text),
            index: items.length
        });
    }

    return function getSuggestions(text, limit = defaultLimit) {
        limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : defaultLimit;

        const query = normalize(text);
        if (!query) return items.slice(0, limit).map(item => item.value);

        const tokens = tokenize(query);
        const compactQuery = tokens.join("");

        return items
            .map(item => ({ item, score: scoreItem(item, query, tokens, compactQuery) }))
            .filter(r => r.score !== Infinity)
            .sort((a, b) =>
                a.score - b.score ||
                a.item.text.length - b.item.text.length || // shorter, more specific hits
                a.item.index - b.item.index
            )
            .slice(0, limit)
            .map(r => r.item.value);
    };
}

class PillInput extends HTMLElement {
    #$container;
    #$pills;
    #$input;
    #$suggestions;
    #$copy;
    #$paste;
    #$clear;
    #initialized = false;
    #disabled = false;
    #getSuggestions = null;

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (this.#initialized) return;
        this.#initialized = true;
        this.#render();

        const initial = this.getAttribute("pill-input-default");
        if (initial) this.#consume(initial, true);

        this.#applyDisabled(); // apply any state set before render
    }

    get delimiters() {
        return this.getAttribute("pill-input-delimiters") ?? "";
    }

    get disabled() {
        return this.#disabled;
    }

    get children() {
        return [...this.#$pills.children];
    }

    disable() {
        this.toggle(true);
    }

    enable() {
        this.toggle(false);
    }

    toggle(force) {
        this.#disabled = force === undefined ? !this.#disabled : !!force;
        this.#applyDisabled();
        return this.#disabled;
    }

    suggest(values) {
        this.#getSuggestions = createSuggestionSearch(Array.from(values, String), 20);
        this.#updateSuggestions();
        return this;
    }

    paste(text) {
        if (!this.#disabled) this.#consume(text, true);
    }

    values() {
        return this.children.map($pill => $pill.value);
    }

    clear() {
        this.#$pills.innerHTML = "";
        this.#pillsChanged();
    }

    #render() {
        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="/css/elements/pill-input.css">
            <div class="container" part="container">
                <div class="input-content">
                    <span class="pills"></span>
                    <input type="text" class="text" autocomplete="off" spellcheck="false">
                </div>
                <div class="actions">
                    <button type="button" class="copy">Copy</button>
                    <button type="button" class="paste">Paste</button>
                    <button type="button" class="clear">Clear</button>
                </div>
                <div class="suggestions" role="listbox" hidden></div>
            </div>
        `;

        const $ = selector => this.shadowRoot.querySelector(selector);
        this.#$container = $(".container");
        this.#$pills = $(".pills");
        this.#$input = $(".text");
        this.#$suggestions = $(".suggestions");
        this.#$copy = $(".copy");
        this.#$paste = $(".paste");
        this.#$clear = $(".clear");

        this.#$container.addEventListener("click", e => {
            if (!this.#disabled && e.target === e.currentTarget) this.#$input.focus();
        });

        this.#$input.addEventListener("paste", e => this.#onPaste(e));
        this.#$input.addEventListener("input", e => this.#onInput(e));
        this.#$input.addEventListener("keydown", e => this.#onKeyDown(e));
        this.#$input.addEventListener("blur", () => {
            this.#commit();
            this.#hideSuggestions();
        });

        this.#$copy.addEventListener("click", async () => {
            try {
                const delimiter = [...this.delimiters][0] ?? "\n";
                await navigator.clipboard.writeText(this.values().join(delimiter));
            } catch (error) {
                console.error("Failed to copy pill input values to the clipboard.", error);
            }
        });
        this.#$paste.addEventListener("click", async () => {
            try {
                this.paste(await navigator.clipboard.readText());
            } catch (error) {
                console.error("Failed to paste pill input values from the clipboard.", error);
            }
        });
        this.#$clear.addEventListener("click", () => this.clear());
    }

    #onPaste(e) {
        if (this.#disabled) return;

        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!/[\r\n]/.test(text)) return;

        e.preventDefault();
        this.#consumeInput(text);
    }

    #onInput(e) {
        if (this.#disabled) return;

        if (e.inputType === "insertFromPaste") {
            this.#consumeInput(this.#$input.value);
        } else {
            this.#consume(this.#$input.value, false);
            this.#updateSuggestions();
        }
    }

    #onKeyDown(e) {
        if (this.#disabled) return;

        switch (e.key) {
            case "Enter": {
                e.preventDefault();
                const $first = this.#$suggestions.querySelector("button");
                if ($first) $first.click();
                else this.#commit();
                break;
            }
            case "ArrowDown":
            case "ArrowUp":
                if (this.#$suggestions.hidden) break;
                e.preventDefault();
                this.#moveSuggestionFocus(e.key === "ArrowDown" ? 1 : -1);
                break;
            case "Backspace":
                this.#onBackspace(e);
                break;
        }
    }

    #onBackspace(e) {
        const { selectionStart, selectionEnd } = this.#$input;
        if (selectionStart !== 0 || selectionEnd !== 0) return;

        const $last = this.#$pills.lastElementChild;
        if (!$last) return;
        e.preventDefault();

        const text = $last.value;
        $last.remove();
        this.#pillsChanged();

        // Ctrl/Alt+Backspace deletes the pill; plain Backspace moves it back into the input for editing.
        if (!e.ctrlKey && !e.altKey) {
            this.#$input.value = text + this.#$input.value;
            this.#$input.setSelectionRange(text.length, text.length);
        }
    }

    #moveSuggestionFocus(step) {
        const $options = [...this.#$suggestions.querySelectorAll("button")];
        if (!$options.length) return;

        const current = $options.indexOf(this.shadowRoot.activeElement);
        const next = current === -1 && step < 0 ? $options.length - 1 : current + step;
        $options[(next + $options.length) % $options.length].focus();
    }

    #applyDisabled() {
        this.classList.toggle("disabled", this.#disabled);

        if (!this.#$input) return; // not rendered yet

        this.#$container.classList.toggle("disabled", this.#disabled);
        this.#$input.disabled = this.#disabled;
        for (const $remove of this.#$pills.querySelectorAll(".remove"))
            $remove.disabled = this.#disabled;

        this.#updateActions();
        if (this.#disabled) this.#hideSuggestions();
    }

    #pillsChanged() {
        this.#updateActions();
        this.dispatchEvent(new CustomEvent("pills-changed", { detail: this.values() }));
    }

    #updateActions() {
        const isEmpty = this.#$pills.children.length === 0;
        this.#$copy.disabled = this.#disabled || isEmpty;
        this.#$paste.disabled = this.#disabled;
        this.#$clear.disabled = this.#disabled || isEmpty;
    }

    #updateSuggestions() {
        if (!this.#getSuggestions) return;

        const text = this.#$input.value.trim();
        const matches = this.#getSuggestions(text);

        this.#$suggestions.replaceChildren(...matches.map(value => {
            const $option = document.createElement("button");
            $option.type = "button";
            $option.textContent = value;
            $option.setAttribute("role", "option");
            $option.addEventListener("mousedown", e => e.preventDefault()); // keep input focused
            $option.addEventListener("click", () => {
                this.#$input.value = "";
                this.#addPill(value);
                this.#hideSuggestions();
                this.#$input.focus();
            });
            return $option;
        }));

        this.#$suggestions.hidden = !text || matches.length === 0 || this.#disabled;
    }

    #hideSuggestions() {
        if (this.#$suggestions) this.#$suggestions.hidden = true;
    }

    /** Turns pasted text into pills and resets the input. */
    #consumeInput(text) {
        this.#consume(text, true);
        this.#$input.value = "";
        this.#hideSuggestions();
    }

    /**
     * Splits `text` on delimiters/newlines and adds a pill per part.
     * When not `final`, the trailing part stays in the input.
     */
    #consume(text, final = false) {
        const chars = new Set([...this.delimiters, "\r", "\n"]);
        const escaped = [...chars].map(c => c.replace(/[\\\]^-]/g, "\\$&")).join("");
        const parts = text.split(new RegExp(`[${escaped}]`));
        const rest = final ? "" : parts.pop();

        parts.forEach(part => this.#addPill(part));
        if (!final) this.#$input.value = rest;
    }

    #commit() {
        if (this.#disabled) return;

        const text = this.#$input.value;
        this.#$input.value = "";
        this.#addPill(text);
    }

    #addPill(text) {
        text = text.trim();
        if (!text) return;

        const $pill = document.createElement("span");
        $pill.className = "pill";

        const $label = document.createElement("span");
        $label.className = "label";
        $label.textContent = text;

        const $remove = document.createElement("button");
        $remove.type = "button";
        $remove.className = "remove";
        $remove.textContent = "\u00d7";
        $remove.disabled = this.#disabled;
        $remove.setAttribute("aria-label", `Remove ${text}`);
        $remove.addEventListener("click", () => {
            if (this.#disabled) return;
            $pill.remove();
            this.#pillsChanged();
        });

        Object.defineProperty($pill, "value", {
            get: () => text,
            set: value => {
                text = value;
                $label.textContent = value;
                $remove.setAttribute("aria-label", `Remove ${value}`);
            }
        });

        $pill.append($label, $remove);
        this.#$pills.append($pill);
        this.#pillsChanged();
    }
}

customElements.define("pill-input", PillInput);