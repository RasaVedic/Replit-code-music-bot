const Database = require('better-sqlite3');
const path = require('path');

// Create database connection
const db = new Database(path.join(__dirname, 'ragabot.db'));

// Initialize tables
function initDatabase() {
    // Guild settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id TEXT PRIMARY KEY,
            prefix TEXT DEFAULT '!',
            volume INTEGER DEFAULT 50,
            autoplay BOOLEAN DEFAULT 0,
            loop_mode INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // User preferences table
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id TEXT PRIMARY KEY,
            favorite_volume INTEGER DEFAULT 50,
            language TEXT DEFAULT 'hi',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Command usage stats
    db.exec(`
        CREATE TABLE IF NOT EXISTS command_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            user_id TEXT,
            command TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('✅ Database initialized successfully!');
    
    // Initialize prepared statements after tables are created
    initPreparedStatements();
}

// Initialize prepared statements after tables are created
let guildSettings, userPreferences, commandStats;

function initPreparedStatements() {
    guildSettings = {
        get: db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?'),
        create: db.prepare('INSERT OR REPLACE INTO guild_settings (guild_id, prefix, volume, autoplay, loop_mode) VALUES (?, ?, ?, ?, ?)'),
        updatePrefix: db.prepare('UPDATE guild_settings SET prefix = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?'),
        updateVolume: db.prepare('UPDATE guild_settings SET volume = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?'),
        updateAutoplay: db.prepare('UPDATE guild_settings SET autoplay = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?'),
        updateLoopMode: db.prepare('UPDATE guild_settings SET loop_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?')
    };

    userPreferences = {
        get: db.prepare('SELECT * FROM user_preferences WHERE user_id = ?'),
        create: db.prepare('INSERT OR REPLACE INTO user_preferences (user_id, favorite_volume, language) VALUES (?, ?, ?)')
    };

    commandStats = {
        add: db.prepare('INSERT INTO command_stats (guild_id, user_id, command) VALUES (?, ?, ?)')
    };
}

// Helper functions
function getGuildSettings(guildId) {
    if (!guildSettings) {
        initPreparedStatements();
    }
    let settings = guildSettings.get.get(guildId);
    if (!settings) {
        guildSettings.create.run(guildId, '!', 50, 0, 0);
        settings = guildSettings.get.get(guildId);
    }
    return settings;
}

function updateGuildPrefix(guildId, prefix) {
    if (!guildSettings) {
        initPreparedStatements();
    }
    guildSettings.updatePrefix.run(prefix, guildId);
}

function updateGuildVolume(guildId, volume) {
    guildSettings.updateVolume.run(volume, guildId);
}

function updateGuildAutoplay(guildId, autoplay) {
    guildSettings.updateAutoplay.run(autoplay ? 1 : 0, guildId);
}

function updateGuildLoopMode(guildId, loopMode) {
    guildSettings.updateLoopMode.run(loopMode, guildId);
}

function getUserPreferences(userId) {
    let prefs = userPreferences.get.get(userId);
    if (!prefs) {
        userPreferences.create.run(userId, 50, 'hi');
        prefs = userPreferences.get.get(userId);
    }
    return prefs;
}

function logCommand(guildId, userId, command) {
    if (!commandStats) {
        initPreparedStatements();
    }
    commandStats.add.run(guildId, userId, command);
}

module.exports = {
    db,
    initDatabase,
    getGuildSettings,
    updateGuildPrefix,
    updateGuildVolume,
    updateGuildAutoplay,
    updateGuildLoopMode,
    getUserPreferences,
    logCommand
};