import { compare } from 'fast-json-patch';
import { Packr, Unpackr, decode } from "msgpackr";
import * as fflate from "fflate";

// Worker state
let lastSyncedDb: any = null;
let lastSyncHash = '';
let currentDb: any = null;

const packr = new Packr({
    useRecords:false
});

const unpackr = new Unpackr({
    int64AsType: 'number',
    useRecords:false
})

const magicHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7]); 
const magicCompressedHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8]);
const magicStreamCompressedHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 9]);


async function checkCompressionStreams(){
    if(!CompressionStream){
        const {makeCompressionStream} = await import('compression-streams-polyfill/ponyfill');
        globalThis.CompressionStream = makeCompressionStream(TransformStream);
    }
    if(!DecompressionStream){
        const {makeDecompressionStream} = await import('compression-streams-polyfill/ponyfill');
        globalThis.DecompressionStream = makeDecompressionStream(TransformStream);
    }
}

export function encodeRisuSaveLegacy(data:any, compression:'noCompression'|'compression' = 'noCompression'){
    let encoded:Uint8Array = packr.encode(data)
    if(compression === 'compression'){
        encoded = fflate.compressSync(encoded)
        const result = new Uint8Array(encoded.length + magicCompressedHeader.length);
        result.set(magicCompressedHeader, 0)
        result.set(encoded, magicCompressedHeader.length)
        return result
    }
    else{
        const result = new Uint8Array(encoded.length + magicHeader.length);
        result.set(magicHeader, 0)
        result.set(encoded, magicHeader.length)
        return result
    }
}

export async function encodeRisuSave(data:any) {
    await checkCompressionStreams()
    let encoded:Uint8Array = packr.encode(data)
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(encoded);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer()
    const result = new Uint8Array(new Uint8Array(buf).length + magicStreamCompressedHeader.length);
    result.set(magicStreamCompressedHeader, 0)
    result.set(new Uint8Array(buf), magicStreamCompressedHeader.length)
    return result
}

export async function decodeRisuSave(data:Uint8Array){
    try {
        switch(checkHeader(data)){
            case "compressed":
                data = data.slice(magicCompressedHeader.length)
                return decode(fflate.decompressSync(data))
            case "raw":
                data = data.slice(magicHeader.length)
                return unpackr.decode(data)
            case "stream":{
                await checkCompressionStreams()
                data = data.slice(magicStreamCompressedHeader.length)
                const cs = new DecompressionStream('gzip');
                const writer = cs.writable.getWriter();
                writer.write(data);
                writer.close();
                const buf = await new Response(cs.readable).arrayBuffer()
                return unpackr.decode(new Uint8Array(buf))
            }
        }
        return unpackr.decode(data)
    }
    catch (error) {
        try {
            console.log('risudecode')
            const risuSaveHeader = new Uint8Array(Buffer.from("\u0000\u0000RISU",'utf-8'))
            const realData = data.subarray(risuSaveHeader.length)
            const dec = unpackr.decode(realData)
            return dec   
        } catch (error) {
            const buf = Buffer.from(fflate.decompressSync(Buffer.from(data)))
            try {
                return JSON.parse(buf.toString('utf-8'))                            
            } catch (error) {
                return unpackr.decode(buf)
            }
        }
    }
}

function checkHeader(data: Uint8Array) {

    let header:'none'|'compressed'|'raw'|'stream' = 'raw'

    if (data.length < magicHeader.length) {
      return false;
    }
  
    for (let i = 0; i < magicHeader.length; i++) {
      if (data[i] !== magicHeader[i]) {
        header = 'none'
        break
      }
    }

    if(header === 'none'){
        header = 'compressed'
        for (let i = 0; i < magicCompressedHeader.length; i++) {
            if (data[i] !== magicCompressedHeader[i]) {
                header = 'none'
                break
            }
        }
    }

    if(header === 'none'){
        header = 'stream'
        for (let i = 0; i < magicStreamCompressedHeader.length; i++) {
            if (data[i] !== magicStreamCompressedHeader[i]) {
                header = 'none'
                break
            }
        }
    }

    // All bytes matched
    return header;
  }

// Compositional hash function for JSON objects in O(n)
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
                        objectHash += (Math.imul(calculateHash(key), PRIME_MULTIPLIER) + calculateHash(node[key]));
                    return objectHash >>> 0;
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
    console.log(`Worker received message of type: ${type}, id: ${id}`);
    try {
        switch (type) {
            case 'init':
                lastSyncedDb = data;
                lastSyncHash = compositionalHash(lastSyncedDb);
                postMessage({ type: 'initialized', id });
                break;

            case 'write':
                currentDb = data;
                postMessage({ type: 'objectWritten', id });
                break;

            case 'getPatch':
                if (!currentDb) throw new Error('Database not loaded before getPatch call');
                let patch = [];
                let needsFullSave = false;
                if (lastSyncedDb === null) {
                    needsFullSave = true;
                } else {
                    patch = compare(lastSyncedDb, currentDb);
                }

                const response = {
                    patch,
                    expectedHash: lastSyncHash,
                    needsFullSave
                };
                
                lastSyncedDb = currentDb;
                lastSyncHash = compositionalHash(currentDb);
                postMessage({ type: 'patchProcessed', id, data: response });
                break;

            case 'encodeLegacy':
                if (!currentDb) throw new Error('Database not loaded before encodeLegacy call');
                const encodedLegacy = encodeRisuSaveLegacy(currentDb);
                postMessage({ type: 'encodedLegacy', id, data: encodedLegacy }, { transfer: [encodedLegacy.buffer.slice(0)] });
                break;

            case 'accountSave':
                if (!currentDb) throw new Error('Database not loaded before accountSave call');
                const encoded: Uint8Array = await encodeRisuSave(currentDb);
                
                // Compare with last synced data using hash
                const currentHash = compositionalHash(currentDb);
                const changed = currentHash !== lastSyncHash;
                
                let valid = false;
                if (changed) {
                    lastSyncedDb = currentDb;
                    lastSyncHash = currentHash;
                    const decoded = await decodeRisuSave(encoded);
                    valid = !!decoded.formatversion;
                }

                const accountResponse = {
                    shouldSave: changed && valid,
                    dbData: encoded,
                };
                
                postMessage({ type: 'accountSaveProcessed', id, data: accountResponse }, { transfer: [encoded.buffer.slice(0)] });
                break;

            default:
                postMessage({ type: 'error', id, error: 'Unknown message type' });
        }
    } catch (error) {
        postMessage({ type: 'error', id, error: error.message });
    }
};
