const DEFAULT_CHUNK_SIZE = 1_000_000;

export class ObjectURLWriter {
    #onChunk;
    #chunkSize;
    #parts = [ ];
    #size = 0;

    constructor(onChunk, chunkSize = DEFAULT_CHUNK_SIZE) {
        this.#onChunk = onChunk;
        this.#chunkSize = chunkSize;
    }

    push(item) {
        const json = JSON.stringify(item);
        this.#parts.push(json);
        this.#size += json.length;
        if (this.#size >= this.#chunkSize) this.flush();
    }

    flush() {
        if (this.#parts.length === 0) return;
        const count = this.#parts.length;
        const blob = new Blob([ "[", this.#parts.join(","), "]" ], { type: "application/json" });
        this.#parts = [ ];
        this.#size = 0;
        this.#onChunk(blob, count);
    }
}

export class ObjectURLList {
    #urls = [ ];
    #length = 0;

    get length() { return this.#length; }

    addChunk(blob, count) {
        this.#urls.push(URL.createObjectURL(blob));
        this.#length += count;
    }

    async *[Symbol.asyncIterator]() {
        for (const url of this.#urls) {
            const response = await fetch(url);
            yield* await response.json();
        }
    }

    revoke() {
        for (const url of this.#urls) URL.revokeObjectURL(url);
        this.#urls = [ ];
        this.#length = 0;
    }
}

export const ReleaseResults = (function(results) {
    for (const user of results ?? [ ])
        for (const project of user.projects ?? [ ])
            project.edits?.revoke?.();
});
