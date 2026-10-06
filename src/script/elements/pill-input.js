class PillInput extends HTMLElement {
    #$pills;
    #$input;
    #initialized = false;
    #disabled = false;

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

    // Mirrors classList.toggle: pass true/false to force a state.
    // Returns the new disabled state.
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
    }

    render() {
        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="/css/elements/pill-input.css">
            <div class="container" part="container">
                <span class="pills"></span>
                <input type="text" class="text" autocomplete="off" spellcheck="false">
            </div>
        `;

        const $root = this.shadowRoot;
        this.#$pills = $root.querySelector(".pills");
        this.#$input = $root.querySelector(".text");

        $root.querySelector(".container").addEventListener("click", e => {
            if (this.#disabled) return;
            if (e.target === e.currentTarget)
                this.#$input.focus();
        });

        this.#$input.addEventListener("input", () => {
            if (this.#disabled) return;
            this.#consume(this.#$input.value);
        });
        this.#$input.addEventListener("blur", () => this.#commit());
        this.#$input.addEventListener("keydown", e => {
            if (this.#disabled) return;

            if (e.key === "Enter") {
                e.preventDefault();
                this.#commit();
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