class PillInput extends HTMLElement {
    #pills;
    #input;
    #initialized = false;

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
    }

    get delimiters() {
        return this.getAttribute("pill-input-delimiters") ?? "";
    }

    render() {
        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="/style/elements/pill-input.css">
            <div class="container" part="container">
                <span class="pills"></span>
                <input type="text" class="text" autocomplete="off" spellcheck="false">
            </div>
        `;

        const root = this.shadowRoot;
        this.#pills = root.querySelector(".pills");
        this.#input = root.querySelector(".text");

        root.querySelector(".container").addEventListener("click", e => {
            if (e.target === e.currentTarget) this.#input.focus();
        });

        this.#input.addEventListener("input", () => this.#consume(this.#input.value));
        this.#input.addEventListener("blur", () => this.#commit());
        this.#input.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.#commit();
            } else if (
                e.key === "Backspace" &&
                this.#input.selectionStart === 0 &&
                this.#input.selectionEnd === 0
            ) {
                const last = this.#pills.lastElementChild;
                if (!last) return;
                e.preventDefault();
                const text = last.firstChild.textContent;
                last.remove();
                this.#input.value = text + this.#input.value;
                this.#input.setSelectionRange(text.length, text.length);
            }
        });
    }

    // Splits text on delimiters; all complete segments become pills.
    // When final is true the trailing segment becomes a pill too.
    #consume(text, final = false) {
        const chars = [...this.delimiters];
        const parts = chars.length
            ? text.split(new RegExp(`[${chars.map(c => c.replace(/[\\\]\[^-]/g, "\\$&")).join("")}]`))
            : [ text ];
        const rest = final ? "" : parts.pop();
        for (const part of parts) this.#addPill(part);
        if (!final) this.#input.value = rest;
    }

    #commit() {
        const text = this.#input.value;
        this.#input.value = "";
        this.#addPill(text);
    }

    #addPill(text) {
        text = text.trim();
        if (!text) return;

        const pill = document.createElement("span");
        pill.className = "pill";

        const label = document.createElement("span");
        label.className = "label";
        label.textContent = text;
        label.value = text;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove";
        remove.textContent = "\u00d7";
        remove.setAttribute("aria-label", `Remove ${text}`);
        remove.addEventListener("click", () => pill.remove());

        pill.append(label, remove);
        this.#pills.append(pill);
    }

    values() {
        return Array.from(this.#pills.children).map(p => p.firstChild.value);
    }
}

customElements.define("pill-input", PillInput);
