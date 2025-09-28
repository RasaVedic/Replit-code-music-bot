const config = require('../config/botConfig');

// Enhanced Music Queue Class with performance optimizations
class EnhancedMusicQueue {
    constructor(guildId) {
        this.guildId = guildId;
        this.songs = [];
        this.nowPlaying = null;
        this.volume = 50;
        this.loop = false;
        this.autoplay = false;
        this.history = [];
        this.textChannel = null;
        this.voiceChannel = null;
        this.player = null;
        this.lastActivity = Date.now();
        this.isPlaylist = false;
        this.playlistInfo = null;
        this.skipVotes = new Set(); // For skip voting
        this.bassBoost = false;
        this.nightcore = false;
        this.filters = new Map(); // Audio filters
    }

    add(song) {
        if (this.songs.length >= config.BOT.MAX_QUEUE_SIZE) {
            throw new Error(`Queue is full! Maximum ${config.BOT.MAX_QUEUE_SIZE} songs allowed.`);
        }
        this.songs.push(song);
    }

    next() {
        if (this.loop && this.nowPlaying) {
            return this.nowPlaying;
        }
        if (this.nowPlaying) {
            this.history.unshift(this.nowPlaying);
            if (this.history.length > 20) {
                this.history.pop();
            }
        }
        return this.songs.shift();
    }

    previous() {
        if (this.history.length > 0) {
            const prev = this.history.shift();
            this.songs.unshift(this.nowPlaying);
            return prev;
        }
        return null;
    }

    clear() {
        this.songs = [];
        this.nowPlaying = null;
        this.skipVotes.clear();
        this.filters.clear();
        this.isPlaylist = false;
        this.playlistInfo = null;
    }

    shuffle() {
        for (let i = this.songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
        }
    }

    isEmpty() {
        return this.songs.length === 0;
    }

    size() {
        return this.songs.length;
    }
    
    // Performance: Bulk add songs for playlist
    addBulk(songs) {
        if (this.songs.length + songs.length > config.BOT.MAX_QUEUE_SIZE) {
            throw new Error(`Queue would exceed maximum size of ${config.BOT.MAX_QUEUE_SIZE} songs!`);
        }
        this.songs.push(...songs);
        this.lastActivity = Date.now();
    }
    
    // Skip vote system for better democracy
    addSkipVote(userId) {
        this.skipVotes.add(userId);
        return this.skipVotes.size;
    }
    
    clearSkipVotes() {
        this.skipVotes.clear();
    }
    
    // Get required skip votes based on voice channel size
    getRequiredSkipVotes(voiceChannelSize) {
        return Math.ceil(voiceChannelSize / 2);
    }
}

// Queue management with performance enhancements
function getQueue(guildId) {
    if (!global.queues.has(guildId)) {
        const queue = new EnhancedMusicQueue(guildId);
        queue.lastActivity = Date.now();
        global.queues.set(guildId, queue);
    }
    const queue = global.queues.get(guildId);
    queue.lastActivity = Date.now();
    return queue;
}

module.exports = {
    EnhancedMusicQueue,
    getQueue
};