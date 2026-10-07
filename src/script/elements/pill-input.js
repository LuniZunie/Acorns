const SEPARATORS = /[\s_.\-/]+/;

const normalize = text =>
    String(text ?? "")
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "") // strip accents
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

const tokenize = text => text.split(SEPARATORS).filter(Boolean);
const allowedErrors = length => (length <= 2 ? 0 : length <= 4 ? 1 : length <= 8 ? 2 : 3);

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

            if (i > 1 && j > 1 && query[i - 1] === word[j - 2] && query[i - 2] === word[j - 1])
                value = Math.min(value, prev2[j - 2] + 1);

            cur[j] = value;
            if (value < rowMin) rowMin = value;
        }

        if (rowMin > max) return Infinity;

        prev2 = prev;
        prev = cur;
    }

    return Math.min(...prev);
}

function scoreToken(token, word) {
    if (word === token) return 0;
    if (word.startsWith(token))
        return 0.1 + 0.4 * (1 - token.length / word.length);
    if (token.length >= 2 && word.includes(token))
        return 1;

    if (token.length < 3) return Infinity;

    const max = allowedErrors(token.length);
    const d = prefixDistance(token, word, max);
    return d <= max ? 1.5 + d : Infinity;
}

function createSuggestionSearch(suggestions = []) {
    const seen = new Set();
    const items = [ ];

    for (const value of suggestions) {
        if (seen.has(value)) continue;
        seen.add(value);

        const text = normalize(value);
        if (!text) continue;

        items.push({
            value,
            text,
            compact: text.replace(SEPARATORS, ""),
            words: tokenize(text),
            index: items.length
        });
    }

    function score(item, query, tokens, compactQuery) {
        const { text } = item;

        if (text === query) return 0;
        if (text.startsWith(query))
            return 1 + (text.length - query.length) / (text.length + 1);

        const position = text.indexOf(query);
        if (position !== -1) {
            const atWordStart = SEPARATORS.test(text[position - 1]);
            return (atWordStart ? 2 : 3) + position / (text.length + 1);
        }

        if (compactQuery.length >= 3 && item.compact.includes(compactQuery))
            return 3.5 + item.compact.indexOf(compactQuery) / (item.compact.length + 1);

        if (!tokens.length) return Infinity;

        let total = 0;
        const used = new Set();
        for (const token of tokens) {
            let best = Infinity, bestIndex = -1;
            item.words.forEach((word, i) => {
                if (used.has(i)) return;
                const s = scoreToken(token, word);
                if (s < best) {
                    best = s;
                    bestIndex = i;
                }
            });

            if (best === Infinity) return Infinity;

            used.add(bestIndex);
            total += best;
        }

        return 4 + total / tokens.length;
    }

    return function getSuggestions(text, limit = 10) {
        limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;

        const query = normalize(text);
        if (!query) return items.slice(0, limit).map(item => item.value);

        const tokens = tokenize(query);
        const compactQuery = tokens.join("");
        const results = [ ];

        for (const item of items) {
            const s = score(item, query, tokens, compactQuery);
            if (s !== Infinity) results.push({ item, score: s });
        }

        return results
            .sort((a, b) =>
                a.score - b.score ||
                a.item.text.length - b.item.text.length ||   // shorter, more specific hits
                a.item.index - b.item.index
            ).slice(0, limit).map(r => r.item.value);
    };
}

class PillInput extends HTMLElement {
    #$pills;
    #$input;
    #$suggestions;
    #initialized = false;
    #disabled = false;
    #suggestionValues = [];

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
        if (this.#initialized) return;
        this.#initialized = true;
        this.render();

        const initial = this.getAttribute("pill-input-default");
        if (initial) this.#consume(initial, true);

        // Apply any state set before render
        this.#applyDisabled();
    }

    get delimiters() {
        return this.getAttribute("pill-input-delimiters") ?? "";
    }

    get disabled() {
        return this.#disabled;
    }

    disable() {
        this.#disabled = true;
        this.#applyDisabled();
    }

    enable() {
        this.#disabled = false;
        this.#applyDisabled();
    }

    toggle(force) {
        this.#disabled = force === undefined ? !this.#disabled : !!force;
        this.#applyDisabled();
        return this.#disabled;
    }

    #applyDisabled() {
        this.classList.toggle("disabled", this.#disabled);

        // Nothing more to do if we haven't rendered yet
        if (!this.#$input) return;

        this.shadowRoot.querySelector(".container").classList.toggle("disabled", this.#disabled);
        this.#$input.disabled = this.#disabled;
        for (const $remove of this.#$pills.querySelectorAll(".remove"))
            $remove.disabled = this.#disabled;
        if (this.#disabled) this.#hideSuggestions();
    }

    render() {
        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="/css/elements/pill-input.css">
            <div class="container" part="container">
                <span class="pills"></span>
                <input type="text" class="text" autocomplete="off" spellcheck="false">
                <div class="suggestions" role="listbox" hidden></div>
            </div>
        `;

        const $root = this.shadowRoot;
        this.#$pills = $root.querySelector(".pills");
        this.#$input = $root.querySelector(".text");
        this.#$suggestions = $root.querySelector(".suggestions");

        $root.querySelector(".container").addEventListener("click", e => {
            if (this.#disabled) return;
            if (e.target === e.currentTarget)
                this.#$input.focus();
        });

        this.#$input.addEventListener("input", e => {
            if (this.#disabled) return;
            if (e.inputType === "insertFromPaste") {
                this.#consume(this.#$input.value, true);
                this.#$input.value = "";
                this.#hideSuggestions();
            } else {
                this.#consume(this.#$input.value, false);
                this.#updateSuggestions();
            }
        });
        this.#$input.addEventListener("blur", () => {
            this.#commit();
            this.#hideSuggestions();
        });
        this.#$input.addEventListener("keydown", e => {
            if (this.#disabled) return;

            if (e.key === "Enter") {
                e.preventDefault();
                const $firstSuggestion = this.#$suggestions.querySelector("button");
                if ($firstSuggestion) {
                    $firstSuggestion.click();
                } else {
                    this.#commit();
                }
            } else if (e.key === "ArrowDown" && !this.#$suggestions.hidden) {
                e.preventDefault();
                const $suggestions = [...this.#$suggestions.querySelectorAll("button")];
                const $current = this.#$suggestions.querySelector("button:focus");
                const index = $current ? $suggestions.indexOf($current) : -1;
                $suggestions[(index + 1) % $suggestions.length]?.focus();
            } else if (e.key === "ArrowUp" && !this.#$suggestions.hidden) {
                e.preventDefault();
                const $suggestions = [...this.#$suggestions.querySelectorAll("button")];
                const $current = this.#$suggestions.querySelector("button:focus");
                const index = $current ? $suggestions.indexOf($current) : -1;
                $suggestions[(index - 1 + $suggestions.length) % $suggestions.length]?.focus();
            } else if (
                e.key === "Backspace" &&
                this.#$input.selectionStart === 0 &&
                this.#$input.selectionEnd === 0
            ) {
                const $last = this.#$pills.lastElementChild;
                if (!$last) return;
                e.preventDefault();

                const text = $last.firstChild.textContent;
                $last.remove();
                this.#pillsChanged();

                if (!e.ctrlKey && !e.altKey) {
                    this.#$input.value = text + this.#$input.value;
                    this.#$input.setSelectionRange(text.length, text.length);
                }
            }
        });
    }

    #pillsChanged() {
        this.dispatchEvent(new CustomEvent("pills-changed", {
            detail: this.values()
        }));
    }

    #getSuggestions;
    suggest(values) {
        this.#suggestionValues = Array.from(values, value => `${value}`);
        this.#getSuggestions = createSuggestionSearch(this.#suggestionValues, 20);

        this.#updateSuggestions();

        return this;
    }

    #updateSuggestions() {
        if (!this.#getSuggestions) return;

        const text = this.#$input.value.trim();
        const matches = this.#getSuggestions(text)

        this.#$suggestions.innerHTML = "";
        for (const value of matches) {
            const $option = document.createElement("button");
            $option.type = "button";
            $option.textContent = value;
            $option.setAttribute("role", "option");
            $option.addEventListener("mousedown", e => e.preventDefault());
            $option.addEventListener("click", () => {
                this.#$input.value = "";
                this.#addPill(value);
                this.#hideSuggestions();
                this.#$input.focus();
            });
            this.#$suggestions.append($option);
        }

        this.#$suggestions.hidden = !text || matches.length === 0 || this.#disabled;
    }

    #hideSuggestions() {
        if (this.#$suggestions) this.#$suggestions.hidden = true;
    }

    #consume(text, final = false) {
        const chars = [ ...this.delimiters ];
        const parts = chars.length ? text.split(new RegExp(`[${chars.map(c => c.replace(/[\\\]\[^-]/g, "\\$&")).join("")}]`)) : [ text ];
        const rest = final ? "" : parts.pop();
        for (const part of parts)
            this.#addPill(part);
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
        });

        Object.defineProperty($pill, "value", {
            get: () => text,
            set: v => {
                text = v;
                $label.textContent = v;
            }
        });

        $pill.append($label, $remove);
        this.#$pills.append($pill);
        this.#pillsChanged();
    }

    paste(text) {
        if (this.#disabled) return;
        this.#consume(text, true);
    }

    values() {
        return Array.from(this.#$pills.children).map($pill => $pill.value);
    }

    clear() {
        this.#$pills.innerHTML = "";
        this.#pillsChanged();
    }

    get children() {
        return Array.from(this.#$pills.children);
    }
}

customElements.define("pill-input", PillInput);