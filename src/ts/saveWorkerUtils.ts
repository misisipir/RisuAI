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

interface AccountSaveResult {
    shouldSave: boolean;
    dbData: Uint8Array;
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

    private postMessage(type: string, data?: any): Promise<any> {
        const id = (this.messageId++).toString();
        
        return new Promise((resolve, reject) => {
            this.pendingPromises.set(id, { resolve, reject });
            this.worker.postMessage({ type, id, data });
        });
    }

    async init(db: any): Promise<void> {
        await this.postMessage('init', db);
    }

    async write(db: any): Promise<void> {
        await this.postMessage('write', db);
    }

    async getPatch(): Promise<PatchResult> {
        return await this.postMessage('getPatch');
    }

    async encodeLegacy(): Promise<Uint8Array> {
        return await this.postMessage('encodeLegacy');
    }

    async accountSave(): Promise<AccountSaveResult> {
        return await this.postMessage('accountSave');
    }

    terminate(): void {
        this.worker.terminate();
        this.pendingPromises.forEach(({ reject }) => {
            reject(new Error('Worker terminated'));
        });
        this.pendingPromises.clear();
    }
}