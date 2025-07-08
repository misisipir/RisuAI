// Web Worker for database save operations
import { compare } from 'fast-json-patch';
import { Packr } from "msgpackr";
import * as fflate from "fflate";

// Worker state
let lastSyncedDb: any = null;
let lastSyncHash = '';

// Initialize packr
const packr = new Packr({
    useRecords: false
});

// Magic headers for save formats
const magicHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7]); 
const magicCompressedHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8]);
const magicStreamCompressedHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 9]);

// Copied encoding functions
function encodeRisuSaveLegacy(data: any, compression: 'noCompression' | 'compression' = 'noCompression') {
    let encoded: Uint8Array = packr.encode(data);
    if (compression === 'compression') {
        encoded = fflate.compressSync(encoded);
        const result = new Uint8Array(encoded.length + magicCompressedHeader.length);
        result.set(magicCompressedHeader, 0);
        result.set(encoded, magicCompressedHeader.length);
        return result;
    } else {
        const result = new Uint8Array(encoded.length + magicHeader.length);
        result.set(magicHeader, 0);
        result.set(encoded, magicHeader.length);
        return result;
    }
}

async function checkCompressionStreams() {
    if (!CompressionStream) {
        const { makeCompressionStream } = await import('compression-streams-polyfill/ponyfill');
        globalThis.CompressionStream = makeCompressionStream(TransformStream);
    }
    if (!DecompressionStream) {
        const { makeDecompressionStream } = await import('compression-streams-polyfill/ponyfill');
        globalThis.DecompressionStream = makeDecompressionStream(TransformStream);
    }
}

async function encodeRisuSave(data: any) {
    await checkCompressionStreams();
    let encoded: Uint8Array = packr.encode(data);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(encoded);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    const result = new Uint8Array(new Uint8Array(buf).length + magicStreamCompressedHeader.length);
    result.set(magicStreamCompressedHeader, 0);
    result.set(new Uint8Array(buf), magicStreamCompressedHeader.length);
    return result;
}

// Copied functions from globalApi.svelte.ts
function compositionalHash(obj: any): string {
    const PRIME_MULTIPLIER = 31;
    
    const SEED_OBJECT = 17;
    const SEED_ARRAY = 19;
    const SEED_STRING = 23;
    const SEED_NUMBER = 29;
    const SEED_BOOLEAN = 31;
    const SEED_NULL = 37;
    
    function calculateHash(node: any): number {
        if (node === null || node === undefined) return SEED_NULL;

        switch (typeof node) {
            case 'object':
                if (Array.isArray(node)) {
                    let arrayHash = SEED_ARRAY;
                    for (const item of node)
                        arrayHash = (Math.imul(arrayHash, PRIME_MULTIPLIER) + calculateHash(item)) >>> 0;
                    return arrayHash;
                } else {
                    let objectHash = SEED_OBJECT;
                    for (const key in node)
                        objectHash = (objectHash ^ (Math.imul(calculateHash(key), PRIME_MULTIPLIER) + calculateHash(node[key]))) >>> 0;
                    return objectHash;
                }

            case 'string':
                let strHash = 2166136261;
                for (let i = 0; i < node.length; i++)
                    strHash = Math.imul(strHash ^ node.charCodeAt(i), 16777619);
                return Math.imul(SEED_STRING, PRIME_MULTIPLIER) + (strHash >>> 0);

            case 'number':
                let numHash;
                if (Number.isInteger(node) && node >= -2147483648 && node <= 2147483647) 
                    numHash = node >>> 0; 
                else {
                    const str = node.toString();
                    numHash = 2166136261;
                    for (let i = 0; i < str.length; i++) 
                        numHash = Math.imul(numHash ^ str.charCodeAt(i), 16777619);
                    numHash = numHash >>> 0;
                }
                return Math.imul(SEED_NUMBER, PRIME_MULTIPLIER) + numHash;

            case 'boolean':
                return Math.imul(SEED_BOOLEAN, PRIME_MULTIPLIER) + (node ? 1 : 0);
                
            default:
                return 0;
        }
    }
    
    const hash = calculateHash(obj);
    return hash.toString(16); 
}

// Message handlers
self.onmessage = async function(e) {
    const { type, data, id } = e.data;
    
    try {
        // Parse the stringified data first
        const parsedData = data ? JSON.parse(data) : null;
        
        switch (type) {
            case 'initialize':
                // Initialize lastSyncedDb from loadData
                if (parsedData) {
                    lastSyncedDb = parsedData;
                    lastSyncHash = compositionalHash(lastSyncedDb);
                }
                postMessage({ type: 'initialized', id });
                break;

            case 'processForPatch':
                // Process database for patch-based save
                if (!parsedData) {
                    throw new Error('Database not provided');
                }
                const dbSnapshot = parsedData;
                let patch = [];
                let needsFullSave = false;
                
                if (lastSyncedDb === null) {
                    needsFullSave = true;
                } else {
                    patch = compare(lastSyncedDb, dbSnapshot);
                }

                // Create a serializable response
                const response = {
                    patch: JSON.parse(JSON.stringify(patch)), // Ensure patch is serializable
                    expectedHash: lastSyncHash,
                    needsFullSave
                };
                
                // Update worker state
                lastSyncedDb = dbSnapshot;
                lastSyncHash = compositionalHash(dbSnapshot);
                
                postMessage({ 
                    type: 'patchProcessed', 
                    id,
                    data: response
                });
                break;

            case 'encodeLegacy':
                // Encode database using legacy format
                if (!parsedData) {
                    throw new Error('Database not provided');
                }
                const encodedLegacy = encodeRisuSaveLegacy(parsedData);
                postMessage({ 
                    type: 'encodedLegacy', 
                    id,
                    data: encodedLegacy
                });
                break;

            case 'encode':
                // Encode database using regular format
                if (!parsedData) {
                    throw new Error('Database not provided');
                }
                const encoded = await encodeRisuSave(parsedData);
                postMessage({ 
                    type: 'encoded', 
                    id,
                    data: encoded
                });
                break;

            default:
                postMessage({ type: 'error', id, error: 'Unknown message type' });
        }
    } catch (error) {
        postMessage({ type: 'error', id, error: error.message });
    }
};
