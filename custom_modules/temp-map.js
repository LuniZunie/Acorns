class TempMap {
    #timeout;

    #store;
    #timeouts;
    #timeoutCallbacks;

    constructor(timeout) {
        if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0))
            throw new RangeError("(TempMap) Argument[0] must be a non-negative finite number");

        this.#timeout = timeout;

        this.#store = new Map();
        this.#timeouts = new Map();
        this.#timeoutCallbacks = new Map();
    }

    #clearTimeout(key) {
        const timer = this.#timeouts.get(key);

        if (timer !== undefined) {
            clearTimeout(timer);
            this.#timeouts.delete(key);
        }
    }

    clear() {
        for (const timeout of this.#timeouts.values())
            clearTimeout(timeout);

        this.#store.clear();
        this.#timeouts.clear();
        this.#timeoutCallbacks.clear();
    }

    has(key) {
        return this.#store.has(key);
    }

    get(key) {
        return this.#store.get(key);
    }

    set(key, value) {
        const exists = this.#store.has(key);
        if (exists) {
            this.#store.delete(key);
            this.#clearTimeout(key);
        }

        this.#store.set(key, value);

        if (this.#timeout !== undefined)
            this.#timeouts.set(key, setTimeout(() => {
                this.delete(key);

                const timeoutCallbacks = this.#timeoutCallbacks.get(key);
                if (timeoutCallbacks) {
                    for (const callback of timeoutCallbacks)
                        callback();
                    this.#timeoutCallbacks.delete(key);
                }
            }, this.#timeout));

        return this;
    }

    // Renew the timeout for an existing key or set a new value if the key does not exist.
    renew(key, setter = () => { }) {
        if (typeof setter !== "function")
            throw new TypeError("(TempMap.renew) Argument[1] must be a function");

        if (this.#store.has(key)) {
            this.#clearTimeout(key);
            if (this.#timeout !== undefined)
                this.#timeouts.set(key, setTimeout(() => {
                    this.delete(key);

                    const timeoutCallbacks = this.#timeoutCallbacks.get(key);
                    if (timeoutCallbacks) {
                        for (const callback of timeoutCallbacks)
                            callback();
                        this.#timeoutCallbacks.delete(key);
                    }
                }, this.#timeout));

            return this.#store.get(key);
        } else {
            const value = setter();
            this.#store.set(key, value);

            if (this.#timeout !== undefined)
                this.#timeouts.set(key, setTimeout(() => {
                    this.delete(key);
                }, this.#timeout));

            return value;
        }
    }

    delete(key) {
        if (!this.#store.has(key)) return false;

        this.#store.delete(key);
        this.#clearTimeout(key);
        this.#timeoutCallbacks.delete(key);

        return true;
    }

    addTimeoutListener(key, callback) {
        if (!this.#timeoutCallbacks.has(key)) this.#timeoutCallbacks.set(key, [ ]);
        this.#timeoutCallbacks.get(key).push(callback);
    }

    get timeout() {
        return this.#timeout;
    }

    get size() {
        return this.#store.size;
    }

    keys() {
        return this.#store.keys();
    }

    values() {
        return this.#store.values();
    }

    entries() {
        return this.#store.entries();
    }

    [Symbol.iterator]() {
        return this.#store[Symbol.iterator]();
    }
}

export { TempMap };