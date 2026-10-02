class Time {
    static seconds(n = 1) { return n * 1e3; }
    static minutes(n = 1) { return n * 6e4; }
    static hours(n = 1) { return n * 3.6e6; }
    static days(n = 1) { return n * 8.64e7; }

    static get(obj = { }) {
        if (typeof obj !== "object" || obj === null)
            throw new TypeError("(Time.get) Argument[0] must be an object");

        let total = 0;
        if ("seconds" in obj)
            total += n * 1e3;
        if ("minutes" in obj)
            total += n * 6e4;
        if ("hours" in obj)
            total += n * 3.6e6;
        if ("days" in obj)
            total += n * 8.64e7;

        return total;
    }
}

export { Time };