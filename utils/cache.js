// utils/cache.js - Cache management

const cache = new Map();

function set(key, value, ttl = 300000) { // 5 minut default
    const expiry = Date.now() + ttl;
    cache.set(key, { value, expiry });
}

function get(key) {
    const item = cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
        cache.delete(key);
        return null;
    }
    
    return item.value;
}

function clear() { cache.clear(); }
function size() { return cache.size; }

// Automatické čištění každých 5 minut
setInterval(() => {
    for (const [key, item] of cache.entries()) {
        if (Date.now() > item.expiry) {
            cache.delete(key);
        }
    }
}, 300000);

module.exports = { get, set, clear, size };
