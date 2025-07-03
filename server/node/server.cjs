const express = require('express');
const app = express();
const path = require('path');
const htmlparser = require('node-html-parser');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const fs = require('fs/promises')
const crypto = require('crypto')
const { applyPatch } = require('fast-json-patch')
const { Packr, Unpackr, decode } = require('msgpackr')
const fflate = require('fflate')

// Compositional hash function for JSON objects in O(n)
function compositionalHash(obj) {
    const PRIME_MULTIPLIER = 31;
    
    const SEED_OBJECT = 17;
    const SEED_ARRAY = 19;
    const SEED_STRING = 23;
    const SEED_NUMBER = 29;
    const SEED_BOOLEAN = 31;
    const SEED_NULL = 37;
    
    function calculateHash(node) {
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
// Faster normalization than JSON.parse(JSON.stringify())
function normalizeJSON(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'object') {
        return value; // Primitives are copied by value
    }
    if (Array.isArray(value)) {
        const newArray = [];
        for (const item of value) {
            if (item === undefined) newArray.push(null);
            else newArray.push(normalizeJSON(item));
        }
        return newArray;
    }
    const newObj = {};
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            const propValue = value[key];
            if (propValue !== undefined) newObj[key] = normalizeJSON(propValue);
        }
    }
    return newObj;
}

app.use(express.static(path.join(process.cwd(), 'dist'), {index: false}));
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));
const {pipeline} = require('stream/promises')
const https = require('https');
const sslPath = path.join(process.cwd(), 'server/node/ssl/certificate');
const hubURL = 'https://sv.risuai.xyz'; 

let password = ''

// Configuration flags for patch-based sync
let enablePatchSync = process.env.RISU_PATCH_SYNC === '1' || process.argv.includes('--patch-sync')

if (enablePatchSync) {
    const [major, minor, patch] = process.version.slice(1).split('.').map(Number);
    // v22.7.0, v23 and above have a bug with msgpackr that causes it to crash on encoding risu saves
    if (major >= 23 || (major === 22 && minor === 7 && patch === 0)) {
        console.log(`[Server] Detected problematic Node.js version ${process.version}. Disabling patch-based sync.`);
        enablePatchSync = false;
    }
}

// In-memory database cache for patch-based sync
let dbCache = {}
let saveTimers = {}
const SAVE_INTERVAL = 5000 // Save to disk after 5 seconds of inactivity

const savePath = path.join(process.cwd(), "save")
if(!existsSync(savePath)){
    mkdirSync(savePath)
}

const passwordPath = path.join(process.cwd(), 'save', '__password')
if(existsSync(passwordPath)){
    password = readFileSync(passwordPath, 'utf-8')
}
const hexRegex = /^[0-9a-fA-F]+$/;
function isHex(str) {
    return hexRegex.test(str.toUpperCase().trim()) || str === '__password';
}

// Encoding/decoding functions for RisuSave format
const packr = new Packr({ useRecords: false });
const unpackr = new Unpackr({ int64AsType: 'number', useRecords: false });

const magicHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7]); 
const magicCompressedHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8]);

function checkHeader(data) {
    let header = 'raw';
    
    if (data.length < magicHeader.length) {
        return 'none';
    }
    
    for (let i = 0; i < magicHeader.length; i++) {
        if (data[i] !== magicHeader[i]) {
            header = 'none';
            break;
        }
    }
    
    if (header === 'none') {
        header = 'compressed';
        for (let i = 0; i < magicCompressedHeader.length; i++) {
            if (data[i] !== magicCompressedHeader[i]) {
                header = 'none';
                break;
            }
        }
    }
    
    return header;
}

async function decodeRisuSaveServer(data) {
    try {
        switch(checkHeader(data)){
            case "compressed":
                data = data.slice(magicCompressedHeader.length)
                return decode(fflate.decompressSync(data))
            case "raw":
                data = data.slice(magicHeader.length)
                return unpackr.decode(data)
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

async function encodeRisuSaveServer(data) {
    // Encode to legacy format (no compression for simplicity)
    const encoded = packr.encode(data);
    const result = new Uint8Array(encoded.length + magicHeader.length);
    result.set(magicHeader, 0);
    result.set(encoded, magicHeader.length);
    return result;
}

app.get('/', async (req, res, next) => {

    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'Unknown IP';
    const timestamp = new Date().toISOString();
    console.log(`[Server] ${timestamp} | Connection from: ${clientIP}`);
    
    try {
        const mainIndex = await fs.readFile(path.join(process.cwd(), 'dist', 'index.html'))
        const root = htmlparser.parse(mainIndex)
        const head = root.querySelector('head')
        head.innerHTML = `<script>globalThis.__NODE__ = true; globalThis.__PATCH_SYNC__ = ${enablePatchSync}</script>` + head.innerHTML
        
        res.send(root.toString())
    } catch (error) {
        console.log(error)
        next(error)
    }
})

const reverseProxyFunc = async (req, res, next) => {
    const authHeader = req.headers['risu-auth'];
    if(!authHeader || authHeader.trim() !== password.trim()){
        console.log('incorrect', 'received:', authHeader, 'expected:', password)
        res.status(400).send({
            error:'Password Incorrect'
        });
        return
    }
    
    const urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;

    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return;
    }
    const header = req.headers['risu-header'] ? JSON.parse(decodeURIComponent(req.headers['risu-header'])) : req.headers;
    if(!header['x-forwarded-for']){
        header['x-forwarded-for'] = req.ip
    }
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: req.method,
            headers: header,
            body: JSON.stringify(req.body)
        });
        // get response body as stream
        const originalBody = originalResponse.body;
        // get response headers
        const head = new Headers(originalResponse.headers);
        head.delete('content-security-policy');
        head.delete('content-security-policy-report-only');
        head.delete('clear-site-data');
        head.delete('Cache-Control');
        head.delete('Content-Encoding');
        const headObj = {};
        for (let [k, v] of head) {
            headObj[k] = v;
        }
        // send response headers to client
        res.header(headObj);
        // send response status to client
        res.status(originalResponse.status);
        // send response body to client
        await pipeline(originalResponse.body, res);


    }
    catch (err) {
        next(err);
        return;
    }
}

const reverseProxyFunc_get = async (req, res, next) => {
    const authHeader = req.headers['risu-auth'];
    if(!authHeader || authHeader.trim() !== password.trim()){
        console.log('incorrect', 'received:', authHeader, 'expected:', password)
        res.status(400).send({
            error:'Password Incorrect'
        });
        return
    }
    
    const urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;

    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return;
    }
    const header = req.headers['risu-header'] ? JSON.parse(decodeURIComponent(req.headers['risu-header'])) : req.headers;
    if(!header['x-forwarded-for']){
        header['x-forwarded-for'] = req.ip
    }
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: 'GET',
            headers: header
        });
        // get response body as stream
        const originalBody = originalResponse.body;
        // get response headers
        const head = new Headers(originalResponse.headers);
        head.delete('content-security-policy');
        head.delete('content-security-policy-report-only');
        head.delete('clear-site-data');
        head.delete('Cache-Control');
        head.delete('Content-Encoding');
        const headObj = {};
        for (let [k, v] of head) {
            headObj[k] = v;
        }
        // send response headers to client
        res.header(headObj);
        // send response status to client
        res.status(originalResponse.status);
        // send response body to client
        await pipeline(originalResponse.body, res);
    }
    catch (err) {
        next(err);
        return;
    }
}

async function hubProxyFunc(req, res) {

    try {
        const pathAndQuery = req.originalUrl.replace(/^\/hub-proxy/, '');
        const externalURL = hubURL + pathAndQuery;
        
        const headersToSend = { ...req.headers };
        delete headersToSend.host;
        delete headersToSend.connection;
        
        const response = await fetch(externalURL, {
            method: req.method,
            headers: headersToSend,
            body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
            redirect: 'manual',
            duplex: 'half'
        });
        
        for (const [key, value] of response.headers.entries()) {
            res.setHeader(key, value);
        }
        res.status(response.status);
        
        if (response.status >= 300 && response.status < 400) {
            // Redirect handling (due to ‘/redirect/docs/lua’)
            const redirectUrl = response.headers.get('location');
            if (redirectUrl) {
                
                if (redirectUrl.startsWith('http')) {
                    
                    if (redirectUrl.startsWith(hubURL)) {
                        const newPath = redirectUrl.replace(hubURL, '/hub-proxy');
                        res.setHeader('location', newPath);
                    }
                    
                } else if (redirectUrl.startsWith('/')) {
                    
                    res.setHeader('location', `/hub-proxy${redirectUrl}`);
                }
            }

            return res.end();
        }
        
        await pipeline(response.body, res);
        
    } catch (error) {
        console.error("[Hub Proxy] Error:", error);
        if (!res.headersSent) {
            res.status(502).send({ error: 'Proxy request failed: ' + error.message });
        } else {
            res.end();
        }
    }
}

app.get('/proxy', reverseProxyFunc_get);
app.get('/proxy2', reverseProxyFunc_get);
app.get('/hub-proxy/*', hubProxyFunc);

app.post('/proxy', reverseProxyFunc);
app.post('/proxy2', reverseProxyFunc);
app.post('/hub-proxy/*', hubProxyFunc);

app.get('/api/password', async(req, res)=> {
    if(password === ''){
        res.send({status: 'unset'})
    }
    else if(req.headers['risu-auth']  === password){
        res.send({status:'correct'})
    }
    else{
        res.send({status:'incorrect'})
    }
})

app.post('/api/crypto', async (req, res) => {
    try {
        const hash = crypto.createHash('sha256')
        hash.update(Buffer.from(req.body.data, 'utf-8'))
        res.send(hash.digest('hex'))
    } catch (error) {
        next(error)
    }
})


app.post('/api/set_password', async (req, res) => {
    if(password === ''){
        password = req.body.password
        writeFileSync(passwordPath, password, 'utf-8')
    }
    res.status(400).send("already set")
})

app.get('/api/read', async (req, res, next) => {
    if(req.headers['risu-auth'].trim() !== password.trim()){
        console.log('incorrect')
        res.status(400).send({
            error:'Password Incorrect'
        });
        return
    }
    const filePath = req.headers['file-path'];
    if (!filePath) {
        console.log('no path')
        res.status(400).send({
            error:'File path required'
        });
        return;
    }

    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }
    try {
        const fullPath = path.join(savePath, filePath);
        
        // Stop any pending save timer for this file
        if (saveTimers[filePath]) {
            clearTimeout(saveTimers[filePath]);
            delete saveTimers[filePath];
        }
        
        // write to disk if available in cache
        if (dbCache[filePath]) {
            try {
                let dataToSave = await encodeRisuSaveServer(dbCache[filePath]);
                await fs.writeFile(fullPath, dataToSave);
            } catch (error) {
                console.error(`[Read] Error saving ${filePath}:`, error);
            }
            delete dbCache[filePath];
        }

        // read from disk
        if(!existsSync(path.join(savePath, filePath))){
            res.send();
        }
        else{
            res.setHeader('Content-Type','application/octet-stream');
            res.sendFile(path.join(savePath, filePath));
        }
    } catch (error) {
        next(error);
    }
});

app.get('/api/remove', async (req, res, next) => {
    if(req.headers['risu-auth'].trim() !== password.trim()){
        console.log('incorrect')
        res.status(400).send({
            error:'Password Incorrect'
        });
        return
    }
    const filePath = req.headers['file-path'];
    if (!filePath) {
        res.status(400).send({
            error:'File path required'
        });
        return;
    }
    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }

    try {
        await fs.rm(path.join(savePath, filePath));
        res.send({
            success: true,
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/list', async (req, res, next) => {
    if(req.headers['risu-auth'].trim() !== password.trim()){
        console.log('incorrect')
        res.status(400).send({
            error:'Password Incorrect'
        });
        return
    }
    try {
        const data = (await fs.readdir(path.join(savePath)))
            .map((v) => { return Buffer.from(v, 'hex').toString('utf-8') })
            .filter((v) => { return v.startsWith(req.headers['key-prefix'].trim()) })

        res.send({
            success: true,
            content: data
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/write', async (req, res, next) => {
    if(req.headers['risu-auth'].trim() !== password.trim()){
        console.log('incorrect')
        res.status(400).send({
            error:'Password Incorrect'
        });
        return
    }
    const filePath = req.headers['file-path'];
    const fileContent = req.body
    if (!filePath || !fileContent) {
        res.status(400).send({
            error:'File path required'
        });
        return;
    }
    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }

    try {
        await fs.writeFile(path.join(savePath, filePath), fileContent);
        
        // Clear any pending save timer for this file
        if (saveTimers[filePath]) {
            clearTimeout(saveTimers[filePath]);
            delete saveTimers[filePath];
        }

        // Clear cache for this file since it was directly written
        if (dbCache[filePath]) delete dbCache[filePath];

        res.send({
            success: true
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/patch', async (req, res, next) => {
    // Check if patch sync is enabled
    if (!enablePatchSync) {
        res.status(404).send({
            error: 'Patch sync is not enabled'
        });
        return;
    }
    
    if(req.headers['risu-auth'].trim() !== password.trim()){
        console.log('incorrect')
        res.status(400).send({
            error:'Password Incorrect'
        });
        return
    }
    const filePath = req.headers['file-path'];
    const patch = req.body.patch;
    const expectedHash = req.body.expectedHash;
    
    if (!filePath || !patch || !expectedHash) {
        res.status(400).send({
            error:'File path, patch, and expected hash required'
        });
        return;
    }
    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }

    try {
        const decodedFilePath = Buffer.from(filePath, 'hex').toString('utf-8');
        
        // Load database into memory if not already cached
        if (!dbCache[filePath]) {
            const fullPath = path.join(savePath, filePath);
            if (existsSync(fullPath)) {
                const fileContent = await fs.readFile(fullPath);
                dbCache[filePath] = normalizeJSON(await decodeRisuSaveServer(fileContent));
            } 
            else {
                dbCache[filePath] = {};
            }
        }
        
        // Calculate current hash of the server data using compositional hash
        const serverHash = compositionalHash(dbCache[filePath]);
        
        // Check hash mismatch
        if (expectedHash !== serverHash) {
            console.log(`[Patch] Hash mismatch for ${decodedFilePath}: expected=${expectedHash}..., server=${serverHash}...`);
            res.status(409).send({
                error: 'Hash mismatch - data out of sync',
            });
            return;
        }
        
        // Apply patch to in-memory database
        const result = applyPatch(dbCache[filePath], patch, true);

        // Schedule save to disk (debounced)
        if (saveTimers[filePath]) {
            clearTimeout(saveTimers[filePath]);
        }
        saveTimers[filePath] = setTimeout(async () => {
            try {
                const fullPath = path.join(savePath, filePath);
                let dataToSave = await encodeRisuSaveServer(dbCache[filePath]);
                await fs.writeFile(fullPath, dataToSave);
                // Create backup for database files after successful save
                if (decodedFilePath.includes('database/database.bin')) {
                    try {
                        const timestamp = Math.floor(Date.now() / 100).toString();
                        const backupFileName = `database/dbbackup-${timestamp}.bin`;
                        const backupFilePath = Buffer.from(backupFileName, 'utf-8').toString('hex');
                        const backupFullPath = path.join(savePath, backupFilePath);
                        // Create backup using the same data that was just saved
                        await fs.writeFile(backupFullPath, dataToSave);
                    } catch (backupError) {
                        console.error(`[Patch] Error creating backup:`, backupError);
                    }
                }
            } catch (error) {
                console.error(`[Patch] Error saving ${filePath}:`, error);
            } finally {
                delete saveTimers[filePath];
            }
        }, SAVE_INTERVAL);

        res.send({
            success: true,
            appliedOperations: result.length,
        });
    } catch (error) {
        console.error(`[Patch] Error applying patch to ${filePath}:`, error.name);
        res.status(500).send({
            error: 'Patch application failed: ' + (error && error.message ? error.message : error)
        });
    }
});

async function getHttpsOptions() {

    const keyPath = path.join(sslPath, 'server.key');
    const certPath = path.join(sslPath, 'server.crt');

    try {
 
        await fs.access(keyPath);
        await fs.access(certPath);

        const [key, cert] = await Promise.all([
            fs.readFile(keyPath),
            fs.readFile(certPath)
        ]);
       
        return { key, cert };

    } catch (error) {
        console.error('[Server] SSL setup errors:', error.message);
        console.log('[Server] Start the server with HTTP instead of HTTPS...');
        return null;
    }
}

async function startServer() {
    try {
      
        const port = process.env.PORT || 6001;
        const httpsOptions = await getHttpsOptions();        if (httpsOptions) {
            // HTTPS
            https.createServer(httpsOptions, app).listen(port, () => {
                console.log("[Server] HTTPS server is running.");
                console.log(`[Server] https://localhost:${port}/`);
                console.log(`[Server] Patch sync: ${enablePatchSync ? 'ENABLED' : 'DISABLED'}`);
            });
        } else {
            // HTTP
            app.listen(port, () => {
                console.log("[Server] HTTP server is running.");
                console.log(`[Server] http://localhost:${port}/`);
                console.log(`[Server] Patch sync: ${enablePatchSync ? 'ENABLED' : 'DISABLED'}`);
            });
        }
    } catch (error) {
        console.error('[Server] Failed to start server :', error);
        process.exit(1);
    }
}

(async () => {
    await startServer();
})();
