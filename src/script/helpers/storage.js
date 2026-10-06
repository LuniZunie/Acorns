export class Storage {
    static #UUID = "01a10de6-79a5-70df-81b2-1a234a2038bc";
    static getItem(key) {
        return localStorage.getItem(`${this.#UUID}-${key}`);
    }

    static setItem(key, value) {
        localStorage.setItem(`${this.#UUID}-${key}`, value);
    }

    static removeItem(key) {
        localStorage.removeItem(`${this.#UUID}-${key}`);
    }
}