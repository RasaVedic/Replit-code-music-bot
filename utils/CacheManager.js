const { getGuildSettings } = require('../src/database');

// Cache configuration
const CACHE_CONFIG = {
    GUILD_SETTINGS_TTL: 10 * 60 * 1000, // 10 minutes
    SEARCH_RESULTS_TTL: 30 * 60 * 1000, // 30 minutes
    MAX_CACHE_SIZE: 1000,
    CLEANUP_INTERVAL: 5 * 60 * 1000 // 5 minutes
};

// Fast cached guild settings retrieval
function getCachedGuildSettings(guildId) {
    const cached = global.guildSettingsCache.get(guildId);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp < CACHE_CONFIG.GUILD_SETTINGS_TTL)) {
        return cached.data;
    }
    
    // Fallback to database call if not cached or expired
    try {
        const settings = getGuildSettings(guildId);
        global.guildSettingsCache.set(guildId, {
            data: settings,
            timestamp: now
        });
        return settings;
    } catch (error) {
        console.log('Guild settings cache fallback failed:', error.message);
        return { language: 'hi', prefix: '!' }; // Default fallback
    }
}

// Cached search results for better performance
function getCachedSearchResults(query, limit = 1) {
    const YouTube = require('youtube-sr').default;
    const cacheKey = `${query}-${limit}`;
    const cached = global.searchResultsCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp < CACHE_CONFIG.SEARCH_RESULTS_TTL)) {
        return Promise.resolve(cached.data);
    }
    
    // Return a promise for fresh search
    return YouTube.search(query, { limit }).then(results => {
        global.searchResultsCache.set(cacheKey, {
            data: results,
            timestamp: now
        });
        return results;
    });
}

// Performance cache cleanup
function performCacheCleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    // Clean expired guild settings
    for (const [key, data] of global.guildSettingsCache.entries()) {
        if (now - data.timestamp > CACHE_CONFIG.GUILD_SETTINGS_TTL) {
            global.guildSettingsCache.delete(key);
            cleanedCount++;
        }
    }
    
    // Clean expired search results
    for (const [key, data] of global.searchResultsCache.entries()) {
        if (now - data.timestamp > CACHE_CONFIG.SEARCH_RESULTS_TTL) {
            global.searchResultsCache.delete(key);
            cleanedCount++;
        }
    }
    
    // Proper cache eviction with LRU strategy  
    if (global.guildSettingsCache.size > CACHE_CONFIG.MAX_CACHE_SIZE) {
        const entries = Array.from(global.guildSettingsCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp); // Sort by timestamp
        const toDelete = entries.slice(0, entries.length - CACHE_CONFIG.MAX_CACHE_SIZE);
        toDelete.forEach(([key]) => global.guildSettingsCache.delete(key));
        cleanedCount += toDelete.length;
    }
    
    if (global.searchResultsCache.size > CACHE_CONFIG.MAX_CACHE_SIZE) {
        const entries = Array.from(global.searchResultsCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = entries.slice(0, entries.length - CACHE_CONFIG.MAX_CACHE_SIZE);
        toDelete.forEach(([key]) => global.searchResultsCache.delete(key));
        cleanedCount += toDelete.length;
    }
    
    if (cleanedCount > 0) {
        console.log(`⚡ Performance cache cleanup: removed ${cleanedCount} expired entries`);
    }
}

// Setup cache cleanup interval
function setupCacheCleanup() {
    setInterval(performCacheCleanup, CACHE_CONFIG.CLEANUP_INTERVAL);
    global.lastCacheClean = Date.now();
    console.log('🧹 Cache cleanup scheduler initialized');
}

module.exports = {
    getCachedGuildSettings,
    getCachedSearchResults,
    performCacheCleanup,
    setupCacheCleanup,
    CACHE_CONFIG
};