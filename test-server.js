// test-server.js - KOMPLETNÍ hlavní server s health check endpointem a memory usage

// test-server.js - OPRAVENÁ verze pro Render.com

require('dotenv').config();

const http = require('http');
const url = require('url');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetchBase = require('node-fetch');

const { handleStream } = require('./handlers/stream');

// ✅ KLÍČOVÁ OPRAVA: Použij Render PORT pro addon server
const PORT_ADDON = process.env.PORT || 10000;  // Render default
const PORT_PROXY = process.env.PORT_PROXY || 7160;  // Proxy zůstává

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// Manifest
const manifest = {
    id: 'io.svetserialu.addon.optimized',
    version: '2.4.0',
    name: 'Svět Seriálů CZ OPTIMIZED',
    description: 'České seriály POUZE VOE - rychlá verze bez FileMoon',
    catalogs: [],
    resources: ['stream'],
    types: ['series'],
    idPrefixes: ['tt']
};

// Proxy funkce zůstávají stejné...
function createHlsProxy(originalUrl) {
    return async (req, res) => {
        try {
            const response = await fetchBase(originalUrl, {
                headers: { 'User-Agent': UA }
            });
            
            if (!response.ok) {
                res.statusCode = response.status;
                res.end();
                return;
            }

            let content = await response.text();
            const contentType = response.headers.get('content-type') || 'application/vnd.apple.mpegurl';

            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'Range');
            res.end(content);

        } catch (e) {
            console.error('❌ HLS proxy error:', e.message);
            res.statusCode = 500;
            res.end('HLS Proxy Error');
        }
    };
}

function createMp4Proxy(originalUrl) {
    return async (req, res) => {
        try {
            const headers = { 'User-Agent': UA };
            
            if (req.headers.range) {
                headers['Range'] = req.headers.range;
            }

            const response = await fetchBase(originalUrl, { headers });
            
            Object.keys(response.headers.raw()).forEach(key => {
                res.setHeader(key, response.headers.get(key));
            });
            
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'Range');
            res.statusCode = response.status;
            
            response.body.pipe(res);

        } catch (e) {
            console.error('❌ MP4 proxy error:', e.message);
            res.statusCode = 500;
            res.end('MP4 Proxy Error');
        }
    };
}

const builder = new addonBuilder(manifest);
builder.defineStreamHandler((args) => {
    console.log(`🔍 Stream request: ${args.type} ${args.id}`);
    return Promise.resolve(handleStream(args));
});

// ✅ KLÍČOVÁ OPRAVA: Bind na 0.0.0.0 místo localhost
async function startAddonServer() {
    console.log(`🚀 Starting addon server on port ${PORT_ADDON}...`);
    serveHTTP(builder.getInterface(), { 
        port: PORT_ADDON,
        host: '0.0.0.0'  // ✅ DŮLEŽITÉ pro Render
    });
    console.log(`✅ Addon running at: http://0.0.0.0:${PORT_ADDON}/manifest.json`);
}

async function startProxyServer() {
    console.log(`🔧 Starting proxy server on port ${PORT_PROXY}...`);
    
    const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        
        // Health check endpoint
        if (parsedUrl.pathname === '/health') {
            try {
                const mem = process.memoryUsage();
                const healthData = {
                    status: 'OK',
                    timestamp: new Date().toISOString(),
                    uptime: Math.floor(process.uptime()),
                    memory: {
                        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
                        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024)
                    },
                    ports: {
                        addon: PORT_ADDON,
                        proxy: PORT_PROXY
                    }
                };
                
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(healthData, null, 2));
                return;
                
            } catch (e) {
                res.statusCode = 503;
                res.end(JSON.stringify({
                    status: 'ERROR',
                    message: e.message,
                    timestamp: new Date().toISOString()
                }));
                return;
            }
        }
        
        // HLS Proxy
        if (parsedUrl.pathname === '/hls-proxy') {
            const targetUrl = parsedUrl.query.url;
            if (targetUrl) {
                createHlsProxy(targetUrl)(req, res);
            } else {
                res.statusCode = 400;
                res.end('Missing URL parameter');
            }
        }
        // MP4 Proxy
        else if (parsedUrl.pathname === '/mp4-proxy') {
            const targetUrl = parsedUrl.query.url;
            if (targetUrl) {
                createMp4Proxy(targetUrl)(req, res);
            } else {
                res.statusCode = 400;
                res.end('Missing URL parameter');
            }
        }
        // 404
        else {
            res.statusCode = 404;
            res.end('Not Found');
        }
    });

    // ✅ KLÍČOVÁ OPRAVA: Bind na 0.0.0.0
    server.listen(PORT_PROXY, '0.0.0.0', () => {
        console.log(`✅ Proxy server running on 0.0.0.0:${PORT_PROXY}`);
        console.log(`🩺 Health check: http://0.0.0.0:${PORT_PROXY}/health`);
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Startup
(async () => {
    try {
        await startAddonServer();
        await startProxyServer();
        
        console.log('\n⚡ OPTIMIZED addon ready!');
        console.log(`📺 Addon URL: http://0.0.0.0:${PORT_ADDON}/manifest.json`);
        console.log(`🔧 Proxy URL: http://0.0.0.0:${PORT_PROXY}/`);
        console.log(`🩺 Health check: http://0.0.0.0:${PORT_PROXY}/health`);
        console.log(`\n🌐 Public URLs will be:`);
        console.log(`📺 https://your-app.onrender.com/manifest.json`);
        console.log(`🩺 https://your-app.onrender.com/health`);
        
    } catch (e) {
        console.error('❌ Startup error:', e.message);
        process.exit(1);
    }
})();

