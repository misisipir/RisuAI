// Worker utility class for database save operations
interface WorkerMessage {
    type: string;
    id: string;
    data?: any;
    error?: string;
}

interface PatchResult {
    patch: any[];
    expectedHash: string;
    needsFullSave: boolean;
}

export class SaveWorker {
    private worker: Worker;
    private pendingPromises: Map<string, { resolve: Function, reject: Function }> = new Map();
    private messageId: number = 0;

    constructor() {
        this.worker = new Worker(new URL('./saveWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = this.handleError.bind(this);
    }

    private handleMessage(event: MessageEvent<WorkerMessage>) {
        const { type, id, data, error } = event.data;
        const pending = this.pendingPromises.get(id);

        if (!pending) return;

        if (error) {
            pending.reject(new Error(error));
        } else {
            pending.resolve(data);
        }

        this.pendingPromises.delete(id);
    }

    private handleError(error: ErrorEvent) {
        console.error('Save worker error:', error);
        this.pendingPromises.forEach(({ reject }) => {
            reject(new Error('Worker error: ' + error.message));
        });
        this.pendingPromises.clear();
    }

    private postMessage(type: string, data?: string): Promise<any> {
        const id = (this.messageId++).toString();
        
        return new Promise((resolve, reject) => {
            this.pendingPromises.set(id, { resolve, reject });
            this.worker.postMessage({ type, id, data });
        });
    }

    /**
     * Initializes the worker with a baseline database state for patch comparison.
     */
    async init(db: string): Promise<void> {
        await this.postMessage('init', db);
    }

    /**
     * Signals the worker to start receiving a new database.
     */
    async load(): Promise<void> {
        await this.postMessage('load');
    }

    /**
     * Sends a chunk of the database string to the worker.
     */
    async write(chunk: string): Promise<void> {
        await this.postMessage('write', chunk);
    }

    /**
     * Signals the worker that all chunks have been sent and the database can be parsed and stored.
     */
    async commit(): Promise<void> {
        await this.postMessage('commit');
    }

    /**
     * Commands the worker to create a patch from the last committed database.
     */
    async getPatch(): Promise<PatchResult> {
        return await this.postMessage('getPatch');
    }

    /**
     * Commands the worker to encode the last committed database using the legacy format.
     */
    async encodeLegacy(): Promise<Uint8Array> {
        return await this.postMessage('encodeLegacy');
    }

    /**
     * Commands the worker to encode the last committed database using the modern format.
     */
    async encode(): Promise<Uint8Array> {
        return await this.postMessage('encode');
    }

    /**
     * Terminates the worker.
     */
    terminate(): void {
        this.worker.terminate();
        this.pendingPromises.forEach(({ reject }) => {
            reject(new Error('Worker terminated'));
        });
        this.pendingPromises.clear();
    }
}