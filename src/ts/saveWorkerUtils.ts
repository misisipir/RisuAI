// Worker utility class for database save operations
interface WorkerMessage {
    type: string;
    id: string;
    data?: string;
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
        this.worker = new Worker(new URL('./saveWorker.ts', import.meta.url));
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
        // Reject all pending promises
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
     * Initialize the worker with database for patch tracking
     */
    async initialize(db: string): Promise<void> {
        await this.postMessage('initialize', db);
    }

    /**
     * Process database for patch-based save
     */
    async processForPatch(db: string): Promise<PatchResult> {
        return await this.postMessage('processForPatch', db);
    }

    /**
     * Encode database using legacy format
     */
    async encodeLegacy(db: string): Promise<Uint8Array> {
        return await this.postMessage('encodeLegacy', db);
    }

    /**
     * Encode database using regular format
     */
    async encode(db: string): Promise<Uint8Array> {
        return await this.postMessage('encode', db);
    }

    /**
     * Terminate the worker
     */
    terminate(): void {
        this.worker.terminate();
        this.pendingPromises.forEach(({ reject }) => {
            reject(new Error('Worker terminated'));
        });
        this.pendingPromises.clear();
    }
}
