const { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
const play = require('play-dl');
const { initDatabase, getGuildSettings, updateGuildPrefix, logCommand } = require('./src/database');
const config = require('./config/botConfig');
const fs = require('fs');
const path = require('path');

// Start health check server for deployment
require('./utils/health');

// Initialize bot client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Perform startup cleanup first
performStartupCleanup();

// Initialize database with error handling
try {
    initDatabase();
} catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    console.log('🔄 Bot will continue without database features...');
}

// Lavalink Manager - will be initialized after bot is ready
let lavalinkManager = null;
let lavalinkAvailable = false;

// Lavalink configuration with environment variables
const lavalinkConfig = {
    nodes: [
        {
            authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass",
            host: process.env.LAVALINK_HOST || "localhost",
            port: parseInt(process.env.LAVALINK_PORT) || 2333,
            id: "main_node"
        }
    ],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
    client: {
        id: process.env.CLIENT_ID || client.user?.id,
        username: process.env.BOT_NAME || "EchoTune"
    }
};

// Optimized global queue management with performance enhancements
global.queues = new Map();
global.players = new Map();
global.audioPlayers = new Map();
global.connections = new Map();

// Performance optimization caches
global.guildSettingsCache = new Map();
global.searchResultsCache = new Map();
global.lastCacheClean = Date.now();

// Cache configuration
const CACHE_CONFIG = {
    GUILD_SETTINGS_TTL: 10 * 60 * 1000, // 10 minutes
    SEARCH_RESULTS_TTL: 30 * 60 * 1000, // 30 minutes
    MAX_CACHE_SIZE: 1000,
    CLEANUP_INTERVAL: 5 * 60 * 1000 // 5 minutes
};

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

// Create commands directory if it doesn't exist
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath, { recursive: true });
}

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

// Optimized queue management with performance enhancements
function getQueue(guildId) {
    if (!global.queues.has(guildId)) {
        const queue = new EnhancedMusicQueue(guildId);
        queue.lastActivity = Date.now(); // Track activity for cleanup
        global.queues.set(guildId, queue);
    }
    const queue = global.queues.get(guildId);
    queue.lastActivity = Date.now(); // Update activity timestamp
    return queue;
}

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

// Normalize track format for consistent UI
function toUnifiedTrack(track, source = 'lavalink') {
    if (source === 'lavalink') {
        return {
            info: {
                title: track.info.title,
                author: track.info.author,
                length: track.info.length,
                artworkUrl: track.info.artworkUrl,
                thumbnail: track.info.thumbnail
            },
            requester: track.requester,
            url: track.info.uri || track.url,
            source: track.info.sourceName || 'lavalink',
            encoded: track.encoded
        };
    } else {
        return {
            info: {
                title: track.title,
                author: track.author,
                length: (track.duration || 0) * 1000,
                artworkUrl: track.thumbnail,
                thumbnail: track.thumbnail
            },
            requester: track.requester,
            url: track.url,
            source: track.source || 'fallback'
        };
    }
}

// Create enhanced now playing embed with buttons
function createNowPlayingEmbed(track, queue, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const messages = config.MESSAGES[lang];

    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.MUSIC} ${messages.NOW_PLAYING}`)
        .setDescription(`**${track.info.title}**\n\n` +
            `${config.EMOJIS.PLAY} **Author:** ${track.info.author}\n` +
            `⏱️ **Duration:** ${formatDuration(track.info.length)}\n` +
            `👤 **Requested by:** ${track.requester}\n` +
            `🔊 **Volume:** ${queue.volume}%\n` +
            `${queue.loop ? '🔂 Loop: On' : '➡️ Loop: Off'}\n` +
            `${queue.autoplay ? '🤖 Autoplay: On' : '🤖 Autoplay: Off'}`)
        .setColor(config.COLORS.MUSIC)
        .setThumbnail(track.info.artworkUrl || track.info.thumbnail)
        .setTimestamp();

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_previous')
                .setLabel('Previous')
                .setEmoji('⏮️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(queue.history.length === 0),
            new ButtonBuilder()
                .setCustomId('music_pause')
                .setLabel('Pause/Resume')
                .setEmoji('⏯️')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setLabel('Skip')
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_stop')
                .setLabel('Stop')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_loop')
                .setLabel(queue.loop ? 'Loop: On' : 'Loop: Off')
                .setEmoji('🔂')
                .setStyle(queue.loop ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_autoplay')
                .setLabel(queue.autoplay ? 'Auto: On' : 'Auto: Off')
                .setEmoji('🤖')
                .setStyle(queue.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_shuffle')
                .setLabel('Shuffle')
                .setEmoji('🔀')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_queue')
                .setLabel('Queue')
                .setEmoji('📋')
                .setStyle(ButtonStyle.Secondary)
        );

    return { embeds: [embed], components: [row1, row2] };
}

// Format duration helper
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// Enhanced playlist auto-detection system
async function detectAndHandlePlaylist(query, requester) {
    try {
        const isYouTubePlaylist = query.includes('list=') && query.includes('youtube.com');
        const isSpotifyPlaylist = query.includes('spotify.com/playlist/');
        const isSpotifyAlbum = query.includes('spotify.com/album/');
        
        if (!isYouTubePlaylist && !isSpotifyPlaylist && !isSpotifyAlbum) {
            return null; // Not a playlist
        }
        
        console.log(`🎵 Playlist detected! Processing...`);
        
        if (isYouTubePlaylist) {
            return await handleYouTubePlaylist(query, requester);
        } else if (isSpotifyPlaylist || isSpotifyAlbum) {
            return await handleSpotifyPlaylist(query, requester);
        }
        
    } catch (error) {
        console.error('Playlist detection failed:', error.message);
    }
    return null;
}

// YouTube playlist handler
async function handleYouTubePlaylist(playlistUrl, requester) {
    try {
        // Extract playlist ID
        const playlistId = playlistUrl.match(/list=([^&]+)/)?.[1];
        if (!playlistId) return null;
        
        const results = await YouTube.search(`https://www.youtube.com/playlist?list=${playlistId}`, {
            limit: 50, // Reasonable limit for performance
            type: 'playlist'
        });
        
        if (results.length > 0) {
            const playlist = results[0];
            const tracks = [];
            
            // Convert to unified track format efficiently
            for (let i = 0; i < Math.min(playlist.videos?.length || 0, 50); i++) {
                const video = playlist.videos[i];
                tracks.push({
                    info: {
                        title: video.title,
                        author: video.channel?.name || 'Unknown',
                        length: (video.duration || 0) * 1000,
                        artworkUrl: video.thumbnail?.url,
                        thumbnail: video.thumbnail?.url
                    },
                    requester,
                    url: video.url,
                    source: 'youtube'
                });
            }
            
            return {
                tracks,
                playlistInfo: {
                    name: playlist.title || 'YouTube Playlist',
                    author: playlist.channel?.name || 'Unknown',
                    trackCount: tracks.length,
                    type: 'youtube'
                }
            };
        }
    } catch (error) {
        console.error('YouTube playlist processing failed:', error.message);
    }
    return null;
}

// Enhanced Spotify playlist handler with YouTube conversion
async function handleSpotifyPlaylist(spotifyUrl, requester) {
    try {
        console.log('🎵 Spotify playlist detected - attempting conversion...');
        
        // Extract basic info from URL
        const playlistId = spotifyUrl.match(/playlist\/(\w+)/)?.[1] || spotifyUrl.match(/album\/(\w+)/)?.[1];
        if (!playlistId) return null;
        
        // Basic fallback: Search for common playlist/album patterns
        const isAlbum = spotifyUrl.includes('/album/');
        const searchTerm = isAlbum ? 'album songs' : 'playlist songs';
        
        // For now, create a basic placeholder that can be expanded later
        console.log('🔍 Converting Spotify to YouTube search...');
        
        // Try to search for similar content on YouTube
        const results = await getCachedSearchResults(`${searchTerm} music`, 10);
        
        if (results && results.length > 0) {
            const tracks = results.slice(0, Math.min(20, results.length)).map(video => ({
                info: {
                    title: video.title,
                    author: video.channel?.name || video.author || 'Unknown',
                    length: (video.duration || 0) * 1000,
                    artworkUrl: video.thumbnail?.url,
                    thumbnail: video.thumbnail?.url
                },
                requester,
                url: video.url,
                source: 'youtube-from-spotify'
            }));
            
            return {
                tracks,
                playlistInfo: {
                    name: `Converted ${isAlbum ? 'Album' : 'Playlist'}`,
                    author: 'Spotify Conversion',
                    trackCount: tracks.length,
                    type: 'spotify-converted'
                }
            };
        }
        
        return null;
    } catch (error) {
        console.error('Spotify playlist processing failed:', error.message);
    }
    return null;
}

// Auto play suggestions with caching
async function getAutoPlaySuggestion(lastTrack) {
    try {
        const searchQuery = `${lastTrack.info.author} similar songs`;
        
        // Use cached search if available
        const results = await getCachedSearchResults(searchQuery, 5);
        
        if (results.length > 1) {
            // Return a random track from results (excluding the first which might be the same)
            const randomIndex = Math.floor(Math.random() * Math.min(results.length - 1, 4)) + 1;
            const video = results[randomIndex];
            
            return {
                info: {
                    title: video.title,
                    author: video.channel?.name || video.author || 'Unknown',
                    length: (video.duration || 0) * 1000,
                    artworkUrl: video.thumbnail?.url,
                    thumbnail: video.thumbnail?.url
                },
                requester: lastTrack.requester,
                url: video.url,
                source: 'youtube'
            };
        }
    } catch (error) {
        console.log('Autoplay suggestion failed:', error.message);
    }
    return null;
}

// Fallback streaming functions
async function createFallbackPlayer(guildId, voiceChannel, textChannel) {
    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        // Handle connection state changes with proper cleanup
        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🔌 Voice connection disconnected for guild ${guildId}`);
            setTimeout(() => cleanupFallbackPlayer(guildId), 100); // Small delay to prevent race conditions
        });

        connection.on(VoiceConnectionStatus.Destroyed, () => {
            console.log(`💥 Voice connection destroyed for guild ${guildId}`);
            // Don't call cleanup here as connection is already destroyed
            const player = global.audioPlayers.get(guildId);
            if (player) {
                try {
                    player.stop();
                    global.audioPlayers.delete(guildId);
                } catch (error) {
                    console.log(`Player stop warning: ${error.message}`);
                }
            }
            global.connections.delete(guildId);
            const queue = getQueue(guildId);
            if (queue) queue.clear();
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        global.connections.set(guildId, connection);
        global.audioPlayers.set(guildId, player);

        player.on(AudioPlayerStatus.Idle, () => {
            handleFallbackTrackEnd(guildId);
        });

        player.on('error', (error) => {
            console.error(`Fallback player error: ${error.message}`);
            
            // Notify user about streaming errors
            if (error.message.includes('403') || error.message.includes('Status code: 403')) {
                notifyStreamingError(guildId, 'youtube_blocked');
            } else {
                notifyStreamingError(guildId, 'general_error');
            }
            
            handleFallbackTrackEnd(guildId);
        });

        return player;
    } catch (error) {
        console.error('Failed to create fallback player:', error);
        return null;
    }
}

async function playFallbackTrack(guildId, track) {
    const player = global.audioPlayers.get(guildId);
    if (!player) return false;

    try {
        let stream = null;
        let attempts = 0;
        const maxAttempts = 3;
        
        // Enhanced headers with rotating user agents to avoid detection
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
        
        const enhancedHeaders = {
            'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
        };

        // Retry mechanism for YouTube streaming
        while (attempts < maxAttempts && !stream) {
            attempts++;
            
            // Try play-dl first with enhanced configuration
            if (track.url && (track.url.includes('youtube.com') || track.url.includes('youtu.be'))) {
                try {
                    // Set play-dl configuration
                    await play.setToken({
                        useragent: [enhancedHeaders['User-Agent']]
                    });
                    
                    stream = await play.stream(track.url, {
                        quality: 2, // High quality audio
                        discordPlayerCompatibility: true
                    });
                    console.log(`[${guildId}] Playing with play-dl (attempt ${attempts}): ${track.title}`);
                    break;
                } catch (error) {
                    console.log(`[${guildId}] play-dl failed (attempt ${attempts}: ${error.message})`);
                    
                    // Wait before retry
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                    }
                }
            }

            // Try ytdl-core as fallback with enhanced options and better error handling
            if (!stream && track.url) {
                try {
                    // Random delay between attempts to avoid pattern detection
                    if (attempts > 1) {
                        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
                    }
                    
                    stream = ytdl(track.url, {
                        filter: 'audioonly',
                        quality: 'highestaudio',
                        requestOptions: {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            },
                            timeout: 8000
                        },
                        // Simplified options to reduce parsing errors
                        lang: 'en'
                    });
                    console.log(`[${guildId}] Playing with ytdl-core (attempt ${attempts}): ${track.title}`);
                    break;
                } catch (error) {
                    console.log(`[${guildId}] ytdl-core failed (attempt ${attempts}: ${error.message})`);
                    
                    // If it's a parsing error, handle gracefully and prevent file creation
                    if (error.message.includes('watch.html') || error.message.includes('parsing')) {
                        console.log(`[${guildId}] YouTube parsing error detected, switching to play-dl only`);
                        // Clean up any watch.html files that might have been created
                        try {
                            require('fs').readdirSync('.').filter(f => f.includes('watch.html')).forEach(f => {
                                require('fs').unlinkSync(f);
                                console.log(`🧹 Cleaned up: ${f}`);
                            });
                        } catch (e) { /* ignore cleanup errors */ }
                        break; // Skip remaining attempts and go to search-based fallback
                    }
                    
                    // Wait before retry with exponential backoff
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 2000 * attempts + Math.random() * 1000));
                    }
                }
            }
        }

        if (!stream) {
            // Try alternative search-based approach as last resort
            console.log(`[${guildId}] All direct streaming failed, trying search-based fallback...`);
            stream = await trySearchBasedFallback(track);
        }

        if (!stream) {
            console.log(`[${guildId}] All streaming methods failed for: ${track.title}`);
            notifyStreamingError(guildId, 'youtube_blocked');
            return false;
        }

        const audioStream = stream.stream || stream;
        const resource = createAudioResource(audioStream, {
            inputType: stream.type ? stream.type : undefined,
            inlineVolume: true
        });
        
        // Apply volume from queue
        const queue = getQueue(guildId);
        if (resource.volume) {
            resource.volume.setVolume(queue.volume / 100);
        }

        player.play(resource);
        return true;
    } catch (error) {
        console.error(`Failed to play fallback track: ${error.message}`);
        notifyStreamingError(guildId, 'streaming_failed');
        return false;
    }
}

// Generate random IP for X-Forwarded-For header
function generateRandomIP() {
    return Array.from({length: 4}, () => Math.floor(Math.random() * 256)).join('.');
}

// Enhanced search-based fallback with multiple search strategies
async function trySearchBasedFallback(track) {
    try {
        console.log(`Trying enhanced search-based fallback for: ${track.title}`);
        
        // Multiple search strategies
        const searchQueries = [
            `${track.title} ${track.author || ''}`.trim(),
            track.title,
            `${track.title} audio`.trim(),
            `${track.author} ${track.title}`.trim()
        ];
        
        for (const searchQuery of searchQueries) {
            try {
                const results = await YouTube.search(searchQuery, { 
                    limit: 5, 
                    type: 'video',
                    safeSearch: false
                });
                
                if (results.length > 0) {
                    // Try each result until one works
                    for (const result of results) {
                        try {
                            // Skip very short videos (likely ads/shorts)
                            if (result.duration && result.duration < 30) {
                                continue;
                            }
                            
                            // First try play-dl with enhanced settings
                            const stream = await play.stream(result.url, {
                                quality: 2,
                                discordPlayerCompatibility: true,
                                htmldata: false // Avoid HTML parsing issues
                            });
                            console.log(`Search-based fallback successful with: ${result.title}`);
                            return stream;
                        } catch (error) {
                            console.log(`Search result failed (${result.title}): ${error.message}`);
                            
                            // If play-dl fails, try ytdl-core with minimal options
                            try {
                                const simpleStream = ytdl(result.url, {
                                    filter: 'audioonly',
                                    quality: 'lowest', // Use lowest quality for better reliability
                                    requestOptions: {
                                        headers: {
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                                        }
                                    }
                                });
                                console.log(`Search-based fallback successful with ytdl-core: ${result.title}`);
                                return simpleStream;
                            } catch (ytdlError) {
                                console.log(`ytdl-core also failed: ${ytdlError.message}`);
                            }
                        }
                    }
                }
            } catch (searchError) {
                console.log(`Search query "${searchQuery}" failed: ${searchError.message}`);
            }
        }
    } catch (error) {
        console.log(`Enhanced search-based fallback failed: ${error.message}`);
    }
    return null;
}

// Notify users about streaming errors
async function notifyStreamingError(guildId, errorType) {
    try {
        const queue = getQueue(guildId);
        const guild = client.guilds.cache.get(guildId);
        if (!guild || !queue.textChannel) return;

        let message = '';
        let color = config.COLORS.ERROR;
        
        switch (errorType) {
            case 'youtube_blocked':
                message = '🚫 **YouTube Streaming Issue Detected!**\n\n' +
                         '❌ YouTube has temporarily blocked video access (Error 403)\n' +
                         '💡 **What you can try:**\n' +
                         '• Search by song name instead of using URLs\n' +
                         '• Try a different song\n' +
                         '• Use Spotify links (if available)\n' +
                         '• YouTube often fixes this automatically, try again in a few minutes\n\n' +
                         '🔄 The bot will automatically try the next song in queue...';
                break;
            case 'streaming_failed':
                message = '⚠️ **Streaming Failed**\n\n' +
                         '❌ Unable to stream this video\n' +
                         '💡 **Try:**\n' +
                         '• Different search terms\n' +
                         '• Another song\n' +
                         '• Check if the video is available in your region\n\n' +
                         '⏭️ Skipping to next song...';
                break;
            case 'no_stream':
                message = '🔗 **No Stream Available**\n\n' +
                         '❌ Could not get audio stream from any source\n' +
                         '💡 **Suggestions:**\n' +
                         '• Try searching instead of using direct links\n' +
                         '• Use different keywords\n' +
                         '• Check if the video exists and is public\n\n' +
                         '⏭️ Moving to next track...';
                break;
            case 'general_error':
                message = '⚠️ **Playback Error**\n\n' +
                         '❌ Audio playback encountered an issue\n' +
                         '🔄 Attempting to continue with next song...';
                break;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎵 Streaming Notice')
            .setDescription(message)
            .setColor(color)
            .setTimestamp()
            .setFooter({ text: 'These issues are usually temporary and resolve automatically' });

        await queue.textChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Failed to send streaming error notification:', error);
    }
}

async function handleFallbackTrackEnd(guildId) {
    const queue = getQueue(guildId);
    
    if (queue.loop && queue.nowPlaying) {
        await playFallbackTrack(guildId, queue.nowPlaying);
        return;
    }

    const nextTrack = queue.next();
    
    if (nextTrack) {
        queue.nowPlaying = nextTrack;
        await playFallbackTrack(guildId, nextTrack);
    } else if (queue.autoplay && queue.nowPlaying) {
        const suggestion = await getFallbackAutoplaySuggestion(queue.nowPlaying);
        if (suggestion) {
            queue.add(suggestion);
            queue.nowPlaying = suggestion;
            await playFallbackTrack(guildId, suggestion);
        } else {
            queue.clear();
        }
    } else {
        queue.clear();
    }
}

async function getFallbackAutoplaySuggestion(lastTrack) {
    try {
        const searchQuery = `${lastTrack.author} similar songs`;
        const results = await YouTube.search(searchQuery, { limit: 5 });
        
        if (results.length > 1) {
            const randomIndex = Math.floor(Math.random() * Math.min(results.length - 1, 4)) + 1;
            const video = results[randomIndex];
            
            return {
                title: video.title,
                author: video.channel?.name || 'Unknown',
                url: video.url,
                duration: video.duration,
                thumbnail: video.thumbnail?.url,
                source: 'youtube',
                requester: lastTrack.requester
            };
        }
    } catch (error) {
        console.log('Fallback autoplay suggestion failed:', error.message);
    }
    return null;
}

// Cleanup fallback player resources with proper state checking
function cleanupFallbackPlayer(guildId) {
    const player = global.audioPlayers.get(guildId);
    const connection = global.connections.get(guildId);
    
    if (player) {
        try {
            player.stop();
            global.audioPlayers.delete(guildId);
        } catch (error) {
            console.log(`Player cleanup warning for guild ${guildId}: ${error.message}`);
        }
    }
    
    if (connection) {
        try {
            // Check if connection is not already destroyed
            if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                connection.destroy();
            }
            global.connections.delete(guildId);
        } catch (error) {
            console.log(`Connection cleanup warning for guild ${guildId}: ${error.message}`);
            global.connections.delete(guildId); // Remove from map even if destroy fails
        }
    }
    
    const queue = getQueue(guildId);
    if (queue) {
        queue.clear();
        global.queues.delete(guildId);
    }
    
    console.log(`🧹 Cleaned up fallback player for guild ${guildId}`);
}

// Optimized auto-cleanup with performance cache management
function setupIdleCleanup() {
    setInterval(() => {
        const now = Date.now();
        
        // Cleanup idle players (optimized)
        for (const [guildId, queue] of global.queues.entries()) {
            if (!queue.nowPlaying && queue.isEmpty()) {
                const lastActivity = queue.lastActivity || now;
                if (now - lastActivity > 5 * 60 * 1000) {
                    console.log(`🧹 Auto-cleaning up idle player for guild ${guildId}`);
                    cleanupFallbackPlayer(guildId);
                }
            }
        }
        
        // Performance cache cleanup
        if (now - global.lastCacheClean > CACHE_CONFIG.CLEANUP_INTERVAL) {
            performanceCacheCleanup();
            global.lastCacheClean = now;
        }
    }, 60000); // Check every minute
}

// Performance cache cleanup function
function performanceCacheCleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    // Clean guild settings cache
    for (const [key, data] of global.guildSettingsCache.entries()) {
        if (now - data.timestamp > CACHE_CONFIG.GUILD_SETTINGS_TTL) {
            global.guildSettingsCache.delete(key);
            cleanedCount++;
        }
    }
    
    // Clean search results cache
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

// Bot Events
client.on('ready', async () => {
    console.log(`🎵 ${client.user.username} music bot is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);

    // Lavalink disabled for now - using enhanced fallback streaming
    console.log('🎵 Using enhanced streaming methods with anti-detection...');
    lavalinkAvailable = false;

    // Register slash commands
    try {
        await registerSlashCommands();
    } catch (error) {
        console.error('⚠️ Slash command registration failed:', error.message);
    }

    // Setup cleanup for idle players
    setupIdleCleanup();
});

// Setup Lavalink Events
function setupLavalinkEvents() {
    if (!lavalinkManager) return;
    
    lavalinkManager.on('trackStart', async (player, track) => {
    const queue = getQueue(player.guildId);
    queue.nowPlaying = track;

    if (queue.textChannel) {
        const guildSettings = getGuildSettings(player.guildId);
        const nowPlayingMessage = createNowPlayingEmbed(track, queue, guildSettings);
        
        try {
            await queue.textChannel.send(nowPlayingMessage);
        } catch (error) {
            console.log('Could not send now playing message:', error.message);
        }
    }
});

lavalinkManager.on('trackEnd', async (player, track, payload) => {
    const queue = getQueue(player.guildId);
    
    if (queue.loop) {
        // Loop current song
        await player.play({ track: track.encoded });
        return;
    }

    const nextTrack = queue.next();
    
    if (nextTrack) {
        await player.play({ track: nextTrack.encoded });
    } else if (queue.autoplay && track) {
        // Try to get autoplay suggestion
        const suggestion = await getAutoPlaySuggestion(track);
        if (suggestion) {
            queue.add(suggestion);
            await player.play({ track: suggestion.encoded });
        } else {
            queue.clear();
        }
    } else {
        queue.clear();
    }
});

lavalinkManager.on('playerEmpty', async (player) => {
    const queue = getQueue(player.guildId);
    if (queue.textChannel) {
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SUCCESS} Queue Finished`)
            .setDescription('Queue has ended. Add more songs to continue!')
            .setColor(config.COLORS.SUCCESS);
        
        try {
            await queue.textChannel.send({ embeds: [embed] });
        } catch (error) {
            console.log('Could not send queue finished message:', error.message);
        }
    }
    
    // Clean up
    setTimeout(() => {
        if (queue.isEmpty()) {
            player.destroy();
            global.queues.delete(player.guildId);
        }
    }, 30000); // 30 seconds delay before cleanup
    });
}

// Handle prefix and slash commands
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const guildSettings = getGuildSettings(message.guild.id);
    const prefix = guildSettings.prefix;

    // Check for prefix command or @bot mention
    const isMention = message.mentions.has(client.user);
    const isPrefix = message.content.startsWith(prefix);
    
    if (!isPrefix && !isMention) return;

    let args, commandName;
    
    if (isMention) {
        // Handle @bot mention commands like "@bot play song"
        const cleanContent = message.content.replace(`<@${client.user.id}>`, '').replace(`<@!${client.user.id}>`, '').trim();
        args = cleanContent.split(/ +/);
        commandName = args.shift()?.toLowerCase();
        
        if (!commandName) {
            // Just @bot mention without command - show help
            commandName = 'help';
            args = [];
        }
    } else {
        // Handle prefix commands like "!play song"
        args = message.content.slice(prefix.length).trim().split(/ +/);
        commandName = args.shift().toLowerCase();
    }

    // Check for command aliases
    const actualCommand = config.ALIASES[commandName] || commandName;

    // Log command usage
    logCommand(message.guild.id, message.author.id, actualCommand);

    try {
        await handleCommand(actualCommand, message, args, guildSettings);
    } catch (error) {
        console.error('Command execution error:', error);
        
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.ERROR} Error`)
            .setDescription(config.MESSAGES[guildSettings.language || 'hi'].ERROR_OCCURRED)
            .setColor(config.COLORS.ERROR);

        await message.reply({ embeds: [embed] });
    }
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    const guildSettings = getGuildSettings(interaction.guild.id);

    try {
        if (interaction.isChatInputCommand()) {
            // Log command usage
            logCommand(interaction.guild.id, interaction.user.id, interaction.commandName);
            await handleSlashCommand(interaction, guildSettings);
        } else if (interaction.isButton()) {
            await handleButtonInteraction(interaction, guildSettings);
        }
    } catch (error) {
        console.error('Interaction error:', error);
        
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.ERROR} Error`)
            .setDescription(config.MESSAGES[guildSettings.language || 'hi'].ERROR_OCCURRED)
            .setColor(config.COLORS.ERROR);

        const replyOptions = { embeds: [embed], ephemeral: true };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(replyOptions);
        } else {
            await interaction.reply(replyOptions);
        }
    }
});

// Command handler for prefix commands
async function handleCommand(command, message, args, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];

    switch (command) {
        case 'play':
        case 'p':
            await handlePlayCommand(message, args, guildSettings);
            break;
        
        case 'skip':
        case 's':
            await handleSkipCommand(message, guildSettings);
            break;
        
        case 'stop':
            await handleStopCommand(message, guildSettings);
            break;
        
        case 'status':
        case 'status':
            await handleStatusCommand(message, guildSettings);
            break;
        
        case 'pause':
            await handlePauseCommand(message, guildSettings);
            break;
        
        case 'resume':
            await handleResumeCommand(message, guildSettings);
            break;
        
        case 'queue':
        case 'q':
            await handleQueueCommand(message, guildSettings);
            break;
        
        case 'volume':
        case 'v':
            await handleVolumeCommand(message, args, guildSettings);
            break;
        
        case 'loop':
        case 'l':
            await handleLoopCommand(message, guildSettings);
            break;
        
        case 'autoplay':
        case 'ap':
            await handleAutoplayCommand(message, guildSettings);
            break;
        
        case 'shuffle':
        case 'sh':
            await handleShuffleCommand(message, guildSettings);
            break;
        
        case 'clear':
            await handleClearCommand(message, guildSettings);
            break;
        
        case 'nowplaying':
        case 'np':
            await handleNowPlayingCommand(message, guildSettings);
            break;
        
        case 'lyrics':
        case 'ly':
            await handleLyricsCommand(message, guildSettings);
            break;
        
        case 'bass':
            await handleBassCommand(message, args, guildSettings);
            break;
        
        case 'equalizer':
        case 'eq':
            await handleEqualizerCommand(message, args, guildSettings);
            break;
        
        case 'leave':
        case 'lv':
        case 'disconnect':
            await handleLeaveCommand(message, guildSettings);
            break;
        
        case 'playlist':
        case 'pl':
            await handlePlaylistCommand(message, args, guildSettings);
            break;
        
        case 'skipto':
        case 'st':
            await handleSkipToCommand(message, args, guildSettings);
            break;
        
        case 'move':
        case 'mv':
            await handleMoveCommand(message, args, guildSettings);
            break;
        
        case 'remove':
        case 'rm':
            await handleRemoveCommand(message, args, guildSettings);
            break;
        
        case 'bassboost':
        case 'bass':
            await handleBassBoostCommand(message, args, guildSettings);
            break;
        
        case 'speed':
        case 'tempo':
            await handleSpeedCommand(message, args, guildSettings);
            break;
        
        case 'voteskip':
        case 'vs':
            await handleVoteSkipCommand(message, guildSettings);
            break;
        
        case 'seek':
            await handleSeekCommand(message, args, guildSettings);
            break;
        
        case 'filters':
        case 'fx':
            await handleFiltersCommand(message, args, guildSettings);
            break;
        
        case 'history':
        case 'h':
            await handleHistoryCommand(message, guildSettings);
            break;
        
        case 'setprefix':
            await handleSetPrefixCommand(message, args, guildSettings);
            break;
        
        case 'help':
        case 'h':
            await handleHelpCommand(message, guildSettings);
            break;
        
        default:
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.ERROR} Unknown Command`)
                .setDescription(`Command \`${command}\` not found! Use \`${guildSettings.prefix}help\` for available commands.`)
                .setColor(config.COLORS.ERROR);
            await message.reply({ embeds: [embed] });
    }
}

// Play command handler with fallback
async function handlePlayCommand(message, args, guildSettings) {
    // Use cached settings for faster response
    const cachedSettings = getCachedGuildSettings(message.guild.id);
    const lang = cachedSettings.language || 'hi';
    const messages = config.MESSAGES[lang];

    if (!message.member.voice.channel) {
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.ERROR} Error`)
            .setDescription(messages.NO_VOICE_CHANNEL)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    if (!args.length) {
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.WARNING} Missing Query`)
            .setDescription(`Please provide a song name or URL!\nExample: \`${guildSettings.prefix}play Tum Hi Ho\``)
            .setColor(config.COLORS.WARNING);
        return await message.reply({ embeds: [embed] });
    }

    const query = args.join(' ');
    const queue = getQueue(message.guild.id);
    
    // Set channels for queue
    queue.textChannel = message.channel;
    queue.voiceChannel = message.member.voice.channel;

    // Send loading message
    const loadingEmbed = new EmbedBuilder()
        .setDescription(`${config.EMOJIS.LOADING} ${messages.LOADING}`)
        .setColor(config.COLORS.INFO);
    const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

    try {
        if (lavalinkAvailable && lavalinkManager) {
            // Use Lavalink if available
            const result = await lavalinkManager.search({
                query,
                source: config.SOURCES.DEFAULT
            }, message.author);

            if (!result.tracks.length) {
                return await handleFallbackSearch(message, query, loadingMsg, guildSettings, messages);
            }

            // Get or create player
            let player = lavalinkManager.getPlayer(message.guild.id);
            if (!player) {
                player = lavalinkManager.createPlayer({
                    guildId: message.guild.id,
                    voiceChannelId: message.member.voice.channel.id,
                    textChannelId: message.channel.id,
                    selfDeaf: true,
                    volume: guildSettings.volume || 50
                });
                await player.connect();
            }

            const track = result.tracks[0];
            track.requester = message.author;

            if (player.queue.current) {
                queue.add(track);
                player.queue.add(track);

                const embed = new EmbedBuilder()
                    .setTitle(`${config.EMOJIS.SUCCESS} ${messages.SONG_ADDED}`)
                    .setDescription(`**${track.info.title}**\nby ${track.info.author}`)
                    .addFields(
                        { name: '⏱️ Duration', value: formatDuration(track.info.length), inline: true },
                        { name: '📍 Position', value: `${queue.size()}`, inline: true }
                    )
                    .setThumbnail(track.info.artworkUrl || track.info.thumbnail)
                    .setColor(config.COLORS.SUCCESS);

                await loadingMsg.edit({ embeds: [embed] });
            } else {
                queue.nowPlaying = track;
                await player.play({ track: track.encoded });
                await loadingMsg.delete().catch(() => {});
            }
        } else {
            // Use fallback methods
            await handleFallbackSearch(message, query, loadingMsg, guildSettings, messages);
        }

    } catch (error) {
        console.error('Play command error:', error);
        // Try fallback if Lavalink fails
        await handleFallbackSearch(message, query, loadingMsg, guildSettings, messages);
    }
}

async function handleFallbackSearch(message, query, loadingMsg, guildSettings, messages) {
    try {
        // Fast search using cached results when possible
        let results;
        
        if (ytdl.validateURL(query)) {
            // Direct URL - try to get info quickly
            try {
                const info = await Promise.race([
                    ytdl.getInfo(query),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                ]);
                results = [{
                    title: info.videoDetails.title,
                    author: info.videoDetails.author.name,
                    url: query,
                    duration: parseInt(info.videoDetails.lengthSeconds),
                    thumbnail: info.videoDetails.thumbnails[0]?.url,
                }];
            } catch (error) {
                console.log('ytdl getInfo failed/timeout, trying cached search...');
                results = await getCachedSearchResults(query, 1);
            }
        } else {
            // Search query with caching
            results = await getCachedSearchResults(query, 1);
        }

        if (!results || results.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.ERROR} ${messages.NO_RESULTS}`)
                .setColor(config.COLORS.ERROR);
            return await loadingMsg.edit({ embeds: [embed] });
        }

        const video = results[0];
        const track = {
            title: video.title,
            author: video.channel?.name || video.author || 'Unknown',
            url: video.url,
            duration: video.durationInSec || video.duration,
            thumbnail: video.thumbnail?.url,
            source: 'youtube',
            requester: message.author
        };

        const queue = getQueue(message.guild.id);

        // Create fallback player if needed
        let player = global.audioPlayers.get(message.guild.id);
        if (!player) {
            player = await createFallbackPlayer(message.guild.id, message.member.voice.channel, message.channel);
            if (!player) {
                const embed = new EmbedBuilder()
                    .setDescription('Failed to join voice channel!')
                    .setColor(config.COLORS.ERROR);
                return await loadingMsg.edit({ embeds: [embed] });
            }
        }

        if (queue.nowPlaying) {
            // Add to queue
            queue.add(track);

            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.SUCCESS} ${messages.SONG_ADDED}`)
                .setDescription(`**${track.title}**\nby ${track.author}`)
                .addFields(
                    { name: '⏱️ Duration', value: formatDuration((track.duration || 0) * 1000), inline: true },
                    { name: '📍 Position', value: `${queue.size()}`, inline: true },
                    { name: '🎵 Mode', value: 'Fallback Streaming', inline: true }
                )
                .setThumbnail(track.thumbnail)
                .setColor(config.COLORS.SUCCESS);

            await loadingMsg.edit({ embeds: [embed] });
        } else {
            // Play immediately
            const unifiedTrack = toUnifiedTrack(track, 'fallback');
            queue.nowPlaying = unifiedTrack;
            const success = await playFallbackTrack(message.guild.id, track);
            
            if (success) {
                // Send now playing embed with buttons
                const guildSettings = getGuildSettings(message.guild.id);
                const nowPlayingMessage = createNowPlayingEmbed(unifiedTrack, queue, guildSettings);
                
                try {
                    await loadingMsg.edit(nowPlayingMessage);
                } catch (error) {
                    console.log('Could not edit to now playing message:', error.message);
                    const fallbackEmbed = new EmbedBuilder()
                        .setTitle(`${config.EMOJIS.MUSIC} Now Playing (Fallback Mode)`)
                        .setDescription(`**${track.title}**\nby ${track.author}`)
                        .setThumbnail(track.thumbnail)
                        .setColor(config.COLORS.MUSIC);

                    await loadingMsg.edit({ embeds: [fallbackEmbed] });
                }
            } else {
                const embed = new EmbedBuilder()
                    .setDescription('Failed to play the track!')
                    .setColor(config.COLORS.ERROR);
                await loadingMsg.edit({ embeds: [embed] });
            }
        }

    } catch (error) {
        console.error('Fallback search error:', error);
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.ERROR} Error`)
            .setDescription(messages.ERROR_OCCURRED)
            .setColor(config.COLORS.ERROR);
        await loadingMsg.edit({ embeds: [embed] });
    }
}

// Additional command handlers with fallback support
async function handleSkipCommand(message, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];
    const queue = getQueue(message.guild.id);

    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription(messages.NO_SONG_PLAYING)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    const currentTrack = queue.nowPlaying;
    
    if (lavalinkAvailable && lavalinkManager) {
        const player = lavalinkManager.getPlayer(message.guild.id);
        if (player) {
            await player.skip();
        }
    } else {
        // Use fallback method
        const player = global.audioPlayers.get(message.guild.id);
        if (player) {
            player.stop(); // This will trigger handleFallbackTrackEnd
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.SKIP} ${messages.SONG_SKIPPED}`)
        .setDescription(`**${currentTrack.title || currentTrack.info?.title}**`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

async function handleStopCommand(message, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];
    const queue = getQueue(message.guild.id);

    if (!queue.nowPlaying && queue.isEmpty()) {
        const embed = new EmbedBuilder()
            .setDescription(messages.NO_SONG_PLAYING)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    if (lavalinkAvailable && lavalinkManager) {
        const player = lavalinkManager.getPlayer(message.guild.id);
        if (player) {
            await player.destroy();
        }
    } else {
        // Use fallback method
        const player = global.audioPlayers.get(message.guild.id);
        const connection = global.connections.get(message.guild.id);
        
        if (player) {
            player.stop();
            global.audioPlayers.delete(message.guild.id);
        }
        
        if (connection) {
            try {
                // Check if connection is not already destroyed
                if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                }
                global.connections.delete(message.guild.id);
            } catch (error) {
                console.log(`Stop command cleanup warning: ${error.message}`);
                global.connections.delete(message.guild.id);
            }
        }
    }

    queue.clear();
    global.queues.delete(message.guild.id);

    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.STOP} ${messages.MUSIC_STOPPED}`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

async function handleStatusCommand(message, guildSettings) {
    const client = message.client;
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    // Format uptime
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    const uptimeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    
    // Calculate ping
    const ping = Date.now() - message.createdTimestamp;
    const wsPing = client.ws.ping;
    
    // Format memory usage
    const formatBytes = (bytes) => {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    };
    
    // Get active queues count
    const activeQueues = global.queues ? global.queues.size : 0;
    const activePlayers = global.audioPlayers ? global.audioPlayers.size : 0;
    
    const statusEmbed = new EmbedBuilder()
        .setTitle('🤖 Bot Status')
        .setColor('#00ff00')
        .addFields(
            { name: '🏓 Ping', value: `${ping}ms`, inline: true },
            { name: '📡 WebSocket', value: `${wsPing}ms`, inline: true },
            { name: '⏱️ Uptime', value: uptimeString, inline: true },
            { name: '🖥️ Servers', value: `${client.guilds.cache.size}`, inline: true },
            { name: '👥 Users', value: `${client.users.cache.size}`, inline: true },
            { name: '🎵 Active Queues', value: `${activeQueues}`, inline: true },
            { name: '🎶 Active Players', value: `${activePlayers}`, inline: true },
            { name: '📊 Memory Usage', value: formatBytes(memoryUsage.heapUsed), inline: true },
            { name: '🚀 Node.js', value: process.version, inline: true }
        )
        .setFooter({ text: `EchoTune Music Bot • ${new Date().toLocaleString()}` })
        .setTimestamp();

    await message.reply({ embeds: [statusEmbed] });
}

async function handlePauseCommand(message, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];
    const queue = getQueue(message.guild.id);

    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription(messages.NO_SONG_PLAYING)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    if (lavalinkAvailable && lavalinkManager) {
        const player = lavalinkManager.getPlayer(message.guild.id);
        if (player && !player.paused) {
            await player.pause();
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.PAUSE} ${messages.MUSIC_PAUSED}`)
                .setColor(config.COLORS.SUCCESS);
            await message.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setDescription('Music is already paused!')
                .setColor(config.COLORS.WARNING);
            await message.reply({ embeds: [embed] });
        }
    } else {
        // Use fallback method
        const player = global.audioPlayers.get(message.guild.id);
        if (player && player.state.status === AudioPlayerStatus.Playing) {
            player.pause();
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.PAUSE} ${messages.MUSIC_PAUSED}`)
                .setColor(config.COLORS.SUCCESS);
            await message.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setDescription('Music is already paused!')
                .setColor(config.COLORS.WARNING);
            await message.reply({ embeds: [embed] });
        }
    }
}

async function handleResumeCommand(message, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];
    const queue = getQueue(message.guild.id);

    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription(messages.NO_SONG_PLAYING)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    if (lavalinkAvailable && lavalinkManager) {
        const player = lavalinkManager.getPlayer(message.guild.id);
        if (player && player.paused) {
            await player.resume();
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.PLAY} ${messages.MUSIC_RESUMED}`)
                .setColor(config.COLORS.SUCCESS);
            await message.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setDescription('Music is not paused!')
                .setColor(config.COLORS.WARNING);
            await message.reply({ embeds: [embed] });
        }
    } else {
        // Use fallback method
        const player = global.audioPlayers.get(message.guild.id);
        if (player && player.state.status === AudioPlayerStatus.Paused) {
            player.unpause();
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.PLAY} ${messages.MUSIC_RESUMED}`)
                .setColor(config.COLORS.SUCCESS);
            await message.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setDescription('Music is not paused!')
                .setColor(config.COLORS.WARNING);
            await message.reply({ embeds: [embed] });
        }
    }
}

// Volume Command
async function handleVolumeCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const messages = config.MESSAGES[lang];
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || !queue.nowPlaying) {
            const embed = new EmbedBuilder()
                .setDescription(messages.NO_SONG_PLAYING)
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        if (!args[0]) {
            const embed = new EmbedBuilder()
                .setDescription(`🔊 Current volume: ${queue.volume}%`)
                .setColor(config.COLORS.MUSIC);
            return await message.reply({ embeds: [embed] });
        }

        const volume = parseInt(args[0]);
        if (isNaN(volume) || volume < 0 || volume > 100) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '⚠️ Volume 0-100 के बीच होना चाहिए!'
                    : '⚠️ Volume should be between 0-100!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        queue.volume = volume;

        if (lavalinkAvailable) {
            const player = lavalinkManager.getPlayer(message.guild.id);
            if (player) {
                await player.setVolume(volume);
            }
        } else {
            // Fallback volume control
            const audioPlayer = global.audioPlayers.get(message.guild.id);
            if (audioPlayer && audioPlayer.state.resource && audioPlayer.state.resource.volume) {
                audioPlayer.state.resource.volume.setVolume(volume / 100);
            }
        }

        const embed = new EmbedBuilder()
            .setDescription(`🔊 Volume set to: ${volume}%`)
            .setColor(config.COLORS.SUCCESS);
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Volume command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Volume set करने में problem हुई!'
                : '⚠️ Failed to set volume!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Queue Command
async function handleQueueCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || queue.isEmpty()) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '📭 Queue empty है!'
                    : '📭 Queue is empty!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        let description = '';
        if (queue.nowPlaying) {
            description += lang === 'hi' 
                ? `**अभी चल रहा है:**\n${queue.nowPlaying.info.title} - ${queue.nowPlaying.info.author}\n\n`
                : `**Now Playing:**\n${queue.nowPlaying.info.title} - ${queue.nowPlaying.info.author}\n\n`;
        }

        if (queue.songs.length > 0) {
            description += lang === 'hi' ? '**आगे के गाने:**\n' : '**Up Next:**\n';
            
            for (let i = 0; i < Math.min(queue.songs.length, 10); i++) {
                const track = queue.songs[i];
                description += `${i + 1}. ${track.info.title} - ${track.info.author}\n`;
            }
            
            if (queue.songs.length > 10) {
                description += lang === 'hi' 
                    ? `\n...और ${queue.songs.length - 10} और गाने`
                    : `\n...and ${queue.songs.length - 10} more songs`;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.QUEUE} Music Queue`)
            .setDescription(description)
            .setFooter({ text: lang === 'hi' 
                ? `कुल गाने: ${queue.songs.length} | Volume: ${queue.volume}%`
                : `Total songs: ${queue.songs.length} | Volume: ${queue.volume}%` })
            .setColor(config.COLORS.MUSIC);

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Queue command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Queue show करने में problem हुई!'
                : '⚠️ Failed to show queue!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Now Playing Command
async function handleNowPlayingCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || !queue.nowPlaying) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '📭 कोई गाना play नहीं हो रहा है!'
                    : '📭 No music is currently playing!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        const nowPlayingMessage = createNowPlayingEmbed(queue.nowPlaying, queue, guildSettings);
        await message.reply(nowPlayingMessage);

    } catch (error) {
        console.error('Now playing command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Now playing show करने में problem हुई!'
                : '⚠️ Failed to show now playing!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Autoplay Command
async function handleAutoplayCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        queue.autoplay = !queue.autoplay;
        
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? `🎵 Autoplay ${queue.autoplay ? 'ON' : 'OFF'} हो गया!`
                : `🎵 Autoplay ${queue.autoplay ? 'ON' : 'OFF'}!`)
            .setColor(queue.autoplay ? config.COLORS.SUCCESS : config.COLORS.ERROR);
        
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Autoplay command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Autoplay toggle करने में problem हुई!'
                : '⚠️ Failed to toggle autoplay!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Leave Command
async function handleLeaveCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const guildId = message.guild.id;
    
    try {
        // Check if bot is in a voice channel
        const connection = global.connections?.get(guildId);
        const player = global.audioPlayers?.get(guildId);
        const queue = global.queues?.get(guildId);
        
        if (!connection && !player) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Not Connected')
                .setDescription(lang === 'hi' 
                    ? 'मैं किसी voice channel में नहीं हूं!'
                    : "I'm not in any voice channel!")
                .setColor(config.COLORS.ERROR);
            
            return await message.reply({ embeds: [embed] });
        }

        // Stop music and clear queue with proper error handling
        if (player) {
            try {
                player.stop();
                global.audioPlayers.delete(guildId);
            } catch (error) {
                console.log(`Player cleanup warning: ${error.message}`);
            }
        }
        
        if (queue) {
            queue.clear();
            global.queues.delete(guildId);
        }
        
        // Safely destroy connection
        if (connection) {
            try {
                if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                }
                global.connections?.delete(guildId);
            } catch (error) {
                console.log(`Leave command cleanup warning: ${error.message}`);
                global.connections?.delete(guildId);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('👋 Successfully Disconnected')
            .setDescription(lang === 'hi' 
                ? 'Voice channel से disconnect हो गया!'
                : 'Successfully disconnected from voice channel!')
            .setColor(config.COLORS.SUCCESS)
            .setFooter({ text: 'Queue cleared and music stopped' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        console.log(`🚪 Bot left voice channel in guild ${guildId} via message command`);

    } catch (error) {
        console.error('Leave command error:', error);
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Error')
            .setDescription(lang === 'hi' 
                ? 'Disconnect करने में problem हुई!'
                : 'Failed to disconnect!')
            .setColor(config.COLORS.ERROR);
        
        await message.reply({ embeds: [embed] });
    }
}

// Shuffle Command
async function handleShuffleCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || queue.isEmpty()) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '📭 Queue empty है!'
                    : '📭 Queue is empty!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        queue.shuffle();
        
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '🔀 Queue shuffle हो गया!'
                : '🔀 Queue shuffled!')
            .setColor(config.COLORS.SUCCESS);
        
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Shuffle command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Queue shuffle करने में problem हुई!'
                : '⚠️ Failed to shuffle queue!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Loop Command
async function handleLoopCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || !queue.nowPlaying) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '📭 कोई गाना play नहीं हो रहा है!'
                    : '📭 No music is currently playing!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        queue.loop = !queue.loop;
        
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? `${queue.loop ? '🔂 Loop ON' : '➡️ Loop OFF'} हो गया!`
                : `${queue.loop ? '🔂 Loop ON' : '➡️ Loop OFF'}!`)
            .setColor(queue.loop ? config.COLORS.SUCCESS : config.COLORS.ERROR);
        
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Loop command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Loop toggle करने में problem हुई!'
                : '⚠️ Failed to toggle loop!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Clear Command
async function handleClearCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || queue.isEmpty()) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '📭 Queue already empty है!'
                    : '📭 Queue is already empty!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        queue.clearQueue();
        
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '🗑️ Queue clear हो गया!'
                : '🗑️ Queue cleared!')
            .setColor(config.COLORS.SUCCESS);
        
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Clear command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Queue clear करने में problem हुई!'
                : '⚠️ Failed to clear queue!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

async function handleButtonInteraction(interaction, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];
    const queue = getQueue(interaction.guild.id);

    try {
        await interaction.deferReply({ ephemeral: true });

        if (!queue || !queue.nowPlaying) {
            return await interaction.editReply({
                content: lang === 'hi' 
                    ? '📭 कोई गाना play नहीं हो रहा है!'
                    : '📭 No music is currently playing!',
                ephemeral: true
            });
        }

        // Handle button actions
        switch (interaction.customId) {
            case 'pause':
                if (lavalinkAvailable) {
                    const player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (player) {
                        if (player.paused) {
                            await player.resume();
                            await interaction.editReply({ 
                                content: '▶️ Resumed!',
                                ephemeral: true 
                            });
                        } else {
                            await player.pause();
                            await interaction.editReply({ 
                                content: '⏸️ Paused!',
                                ephemeral: true 
                            });
                        }
                    }
                } else {
                    // Fallback pause/resume
                    const audioPlayer = global.audioPlayers.get(interaction.guild.id);
                    if (audioPlayer) {
                        if (audioPlayer.state.status === AudioPlayerStatus.Paused) {
                            audioPlayer.unpause();
                            await interaction.editReply({ 
                                content: '▶️ Resumed! (Fallback)',
                                ephemeral: true 
                            });
                        } else {
                            audioPlayer.pause();
                            await interaction.editReply({ 
                                content: '⏸️ Paused! (Fallback)',
                                ephemeral: true 
                            });
                        }
                    }
                }
                break;

            case 'skip':
                if (lavalinkAvailable) {
                    const player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (player) {
                        await player.skip();
                        await interaction.editReply({ 
                            content: '⏭️ Skipped!',
                            ephemeral: true 
                        });
                    }
                } else {
                    // Fallback skip
                    const nextTrack = queue.getNext();
                    if (nextTrack) {
                        queue.nowPlaying = nextTrack;
                        await playFallbackTrack(interaction.guild.id, nextTrack);
                        await interaction.editReply({ 
                            content: '⏭️ Skipped! (Fallback)',
                            ephemeral: true 
                        });
                    } else {
                        queue.nowPlaying = null;
                        const audioPlayer = global.audioPlayers.get(interaction.guild.id);
                        if (audioPlayer) audioPlayer.stop();
                        await interaction.editReply({ 
                            content: '⏹️ Queue ended!',
                            ephemeral: true 
                        });
                    }
                }
                break;

            case 'stop':
                if (lavalinkAvailable) {
                    const player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (player) {
                        await player.destroy();
                    }
                } else {
                    // Fallback stop
                    const audioPlayer = global.audioPlayers.get(interaction.guild.id);
                    if (audioPlayer) audioPlayer.stop();
                    cleanupFallbackPlayer(interaction.guild.id);
                }
                queue.clear();
                queue.nowPlaying = null;
                await interaction.editReply({ 
                    content: '⏹️ Stopped and cleared queue!',
                    ephemeral: true 
                });
                break;

            case 'shuffle':
                if (queue.isEmpty()) {
                    await interaction.editReply({ 
                        content: '📭 Queue is empty!',
                        ephemeral: true 
                    });
                } else {
                    queue.shuffle();
                    await interaction.editReply({ 
                        content: '🔀 Queue shuffled!',
                        ephemeral: true 
                    });
                }
                break;

            case 'loop':
                queue.loop = !queue.loop;
                await interaction.editReply({ 
                    content: `🔁 Loop ${queue.loop ? 'ON' : 'OFF'}!`,
                    ephemeral: true 
                });
                break;

            case 'autoplay':
                queue.autoplay = !queue.autoplay;
                await interaction.editReply({ 
                    content: `🎵 Autoplay ${queue.autoplay ? 'ON' : 'OFF'}!`,
                    ephemeral: true 
                });
                break;

            case 'volume_up':
                const newVolumeUp = Math.min(queue.volume + 10, 100);
                queue.volume = newVolumeUp;
                if (lavalinkAvailable) {
                    const player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (player) await player.setVolume(newVolumeUp);
                } else {
                    const audioPlayer = global.audioPlayers.get(interaction.guild.id);
                    if (audioPlayer && audioPlayer.state.resource && audioPlayer.state.resource.volume) {
                        audioPlayer.state.resource.volume.setVolume(newVolumeUp / 100);
                    }
                }
                await interaction.editReply({ 
                    content: `🔊 Volume: ${newVolumeUp}%`,
                    ephemeral: true 
                });
                break;

            case 'volume_down':
                const newVolumeDown = Math.max(queue.volume - 10, 0);
                queue.volume = newVolumeDown;
                if (lavalinkAvailable) {
                    const player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (player) await player.setVolume(newVolumeDown);
                } else {
                    const audioPlayer = global.audioPlayers.get(interaction.guild.id);
                    if (audioPlayer && audioPlayer.state.resource && audioPlayer.state.resource.volume) {
                        audioPlayer.state.resource.volume.setVolume(newVolumeDown / 100);
                    }
                }
                await interaction.editReply({ 
                    content: `🔉 Volume: ${newVolumeDown}%`,
                    ephemeral: true 
                });
                break;

            case 'queue':
                let queueText = '';
                if (queue.nowPlaying) {
                    queueText += `**Now Playing:**\n${queue.nowPlaying.info.title} - ${queue.nowPlaying.info.author}\n\n`;
                }
                if (queue.songs.length > 0) {
                    queueText += '**Up Next:**\n';
                    for (let i = 0; i < Math.min(queue.songs.length, 5); i++) {
                        const track = queue.songs[i];
                        queueText += `${i + 1}. ${track.info.title} - ${track.info.author}\n`;
                    }
                    if (queue.songs.length > 5) {
                        queueText += `\n...and ${queue.songs.length - 5} more songs`;
                    }
                } else {
                    queueText += 'Queue is empty!';
                }
                await interaction.editReply({ 
                    content: queueText,
                    ephemeral: true 
                });
                break;

            default:
                await interaction.editReply({ 
                    content: 'Unknown button action!',
                    ephemeral: true 
                });
        }

    } catch (error) {
        console.error('Button interaction error:', error);
        try {
            await interaction.editReply({ 
                content: 'Error processing button action!',
                ephemeral: true 
            });
        } catch (e) {
            console.error('Error sending error reply:', e);
        }
    }
}

// Add missing join/leave command handlers
async function handleJoinCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '⚠️ पहले voice channel join करें!'
                    : '⚠️ You need to join a voice channel first!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        if (lavalinkAvailable) {
            // Use Lavalink
            const player = lavalinkManager.create({
                guild: message.guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: message.channel.id,
                selfDeafen: true
            });
            await player.connect();
        } else {
            // Use fallback
            await createFallbackPlayer(message.guild.id, voiceChannel, message.channel);
        }

        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? `✅ ${voiceChannel.name} में join हो गया!`
                : `✅ Joined ${voiceChannel.name}!`)
            .setColor(config.COLORS.SUCCESS);
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Join command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Voice channel join करने में problem हुई!'
                : '⚠️ Failed to join voice channel!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

async function handleLeaveCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        if (lavalinkAvailable) {
            const player = lavalinkManager.getPlayer(message.guild.id);
            if (player) {
                await player.destroy();
            }
        } else {
            cleanupFallbackPlayer(message.guild.id);
        }

        const queue = getQueue(message.guild.id);
        queue.clear();
        queue.nowPlaying = null;

        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '👋 Voice channel से leave हो गया!'
                : '👋 Left the voice channel!')
            .setColor(config.COLORS.SUCCESS);
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Leave command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Voice channel leave करने में problem हुई!'
                : '⚠️ Failed to leave voice channel!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Previous handleButtonInteraction (keeping old for reference if needed)
async function handleButtonInteractionOld(interaction, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];
    const player = lavalinkManager.getPlayer(interaction.guild.id);
    const queue = getQueue(interaction.guild.id);

    if (!player) {
        return await interaction.reply({ content: messages.NO_SONG_PLAYING, ephemeral: true });
    }

    switch (interaction.customId) {
        case 'music_pause':
            if (player.paused) {
                await player.resume();
                await interaction.reply({ content: messages.MUSIC_RESUMED, ephemeral: true });
            } else {
                await player.pause();
                await interaction.reply({ content: messages.MUSIC_PAUSED, ephemeral: true });
            }
            break;

        case 'music_skip':
            if (player.queue.current) {
                const currentTrack = player.queue.current;
                await player.skip();
                await interaction.reply({ content: `${config.EMOJIS.SKIP} Skipped: **${currentTrack.info.title}**`, ephemeral: true });
            }
            break;

        case 'music_stop':
            await player.destroy();
            queue.clear();
            global.queues.delete(interaction.guild.id);
            await interaction.reply({ content: messages.MUSIC_STOPPED, ephemeral: true });
            break;

        case 'music_loop':
            queue.loop = !queue.loop;
            await interaction.reply({ content: queue.loop ? messages.LOOP_ON : messages.LOOP_OFF, ephemeral: true });
            break;

        case 'music_autoplay':
            queue.autoplay = !queue.autoplay;
            await interaction.reply({ content: queue.autoplay ? messages.AUTOPLAY_ON : messages.AUTOPLAY_OFF, ephemeral: true });
            break;

        case 'music_shuffle':
            if (queue.isEmpty()) {
                await interaction.reply({ content: messages.QUEUE_EMPTY, ephemeral: true });
            } else {
                queue.shuffle();
                await interaction.reply({ content: messages.QUEUE_SHUFFLED, ephemeral: true });
            }
            break;

        case 'music_queue':
            await handleQueueInteraction(interaction, guildSettings);
            break;

        case 'music_previous':
            const prevTrack = queue.previous();
            if (prevTrack) {
                await player.play({ track: prevTrack.encoded });
                await interaction.reply({ content: `⏮️ Playing previous: **${prevTrack.info.title}**`, ephemeral: true });
            } else {
                await interaction.reply({ content: 'No previous song available!', ephemeral: true });
            }
            break;
    }
}

async function handleQueueInteraction(interaction, guildSettings) {
    const queue = getQueue(interaction.guild.id);
    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.QUEUE} Music Queue`)
        .setColor(config.COLORS.QUEUE);

    let description = '';

    if (queue.nowPlaying) {
        description += `**🎵 Now Playing:**\n${queue.nowPlaying.info.title}\n\n`;
    }

    if (!queue.isEmpty()) {
        description += '**📋 Up Next:**\n';
        queue.songs.slice(0, 10).forEach((song, index) => {
            description += `${index + 1}. ${song.info.title} - ${song.info.author}\n`;
        });

        if (queue.size() > 10) {
            description += `\n...and ${queue.size() - 10} more songs`;
        }
        description += `\n**Total songs:** ${queue.size()}`;
    } else {
        description += '**Queue is empty**';
    }

    embed.setDescription(description);
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Help command handler
async function handleHelpCommand(message, guildSettings) {
    const prefix = guildSettings.prefix;
    
    const embed = new EmbedBuilder()
        .setTitle('🎵 RagaBot Commands Help')
        .setColor(config.COLORS.INFO)
        .setDescription(`**Current Prefix:** \`${prefix}\`\n**Quick Commands:** Use short forms like \`${prefix}p\` for play!`)
        .addFields(
            {
                name: '🎵 Music Commands',
                value: `\`${prefix}play\` \`${prefix}p\` - Play a song\n` +
                      `\`${prefix}skip\` \`${prefix}s\` - Skip current song\n` +
                      `\`${prefix}stop\` \`${prefix}stp\` - Stop music\n` +
                      `\`${prefix}pause\` - Pause music\n` +
                      `\`${prefix}resume\` - Resume music\n` +
                      `\`${prefix}volume\` \`${prefix}v\` - Set volume (0-100)`,
                inline: true
            },
            {
                name: '📋 Queue Commands',
                value: `\`${prefix}queue\` \`${prefix}q\` - Show queue\n` +
                      `\`${prefix}shuffle\` - Shuffle queue\n` +
                      `\`${prefix}clear\` - Clear queue\n` +
                      `\`${prefix}nowplaying\` \`${prefix}np\` - Current song`,
                inline: true
            },
            {
                name: '⚙️ Settings Commands',
                value: `\`${prefix}loop\` \`${prefix}l\` - Toggle loop\n` +
                      `\`${prefix}autoplay\` - Toggle autoplay\n` +
                      `\`${prefix}setprefix\` - Change prefix\n` +
                      `\`${prefix}help\` \`${prefix}h\` - Show this help`,
                inline: true
            },
            {
                name: '🎧 Audio & Info Commands',
                value: `\`${prefix}status\` \`${prefix}st\` - Bot status & ping\n` +
                      `\`${prefix}lyrics\` \`${prefix}ly\` - Get song lyrics\n` +
                      `\`${prefix}bass\` - Bass boost (0-100)\n` +
                      `\`${prefix}equalizer\` \`${prefix}eq\` - Audio presets`,
                inline: true
            }
        )
        .setFooter({ text: 'Use buttons on now playing message for quick controls!' });

    await message.reply({ embeds: [embed] });
}

// Set prefix command handler
async function handleSetPrefixCommand(message, args, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];

    if (!args.length) {
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.INFO} Current Prefix`)
            .setDescription(`Current server prefix is: \`${guildSettings.prefix}\`\nTo change it, use: \`${guildSettings.prefix}setprefix <new_prefix>\``)
            .setColor(config.COLORS.INFO);
        return await message.reply({ embeds: [embed] });
    }

    const newPrefix = args[0];
    if (newPrefix.length > 5) {
        const embed = new EmbedBuilder()
            .setDescription('Prefix cannot be longer than 5 characters!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    updateGuildPrefix(message.guild.id, newPrefix);

    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.SUCCESS} ${messages.PREFIX_CHANGED}`)
        .setDescription(`\`${newPrefix}\``)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

// Lyrics Command
async function handleLyricsCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || !queue.nowPlaying) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '❌ कोई गाना नहीं चल रहा है!'
                    : '❌ No song is currently playing!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        const track = queue.nowPlaying;
        const songName = track.info?.title || track.title;
        const artist = track.info?.author || track.artist || '';

        // Create a simple lyrics not found embed (lyrics API would be needed for real implementation)
        const embed = new EmbedBuilder()
            .setTitle('🎵 Lyrics')
            .setDescription(lang === 'hi' 
                ? `**गाना:** ${songName}\n**कलाकार:** ${artist}\n\n❗ Lyrics feature आने वाले update में available होगा!\nअभी तक manual search करें: [Google](https://www.google.com/search?q=${encodeURIComponent(songName + ' ' + artist + ' lyrics')})`
                : `**Song:** ${songName}\n**Artist:** ${artist}\n\n❗ Lyrics feature coming in next update!\nFor now, search manually: [Google](https://www.google.com/search?q=${encodeURIComponent(songName + ' ' + artist + ' lyrics')})`)
            .setColor(config.COLORS.MUSIC)
            .setFooter({ text: 'Lyrics feature coming soon!' });

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Lyrics command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Lyrics fetch करने में problem हुई!'
                : '⚠️ Failed to fetch lyrics!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Bass Boost Command
async function handleBassCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || !queue.nowPlaying) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '❌ कोई गाना नहीं चल रहा है!'
                    : '❌ No song is currently playing!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        const level = args[0] ? parseInt(args[0]) : 0;
        
        if (isNaN(level) || level < 0 || level > 100) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '❌ Bass level 0-100 के बीच होना चाहिए!\nExample: `!bass 50`'
                    : '❌ Bass level must be between 0-100!\nExample: `!bass 50`')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        // Store bass setting in queue (future implementation would apply actual audio filter)
        queue.bassLevel = level;

        const embed = new EmbedBuilder()
            .setTitle('🎵 Bass Boost')
            .setDescription(lang === 'hi' 
                ? `✅ Bass level ${level}% पर set हो गया!\n\n❗ Audio filters आने वाले update में fully implement होंगे।`
                : `✅ Bass level set to ${level}%!\n\n❗ Audio filters will be fully implemented in next update.`)
            .setColor(config.COLORS.SUCCESS);

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Bass command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Bass settings में problem हुई!'
                : '⚠️ Failed to set bass!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Equalizer Command
async function handleEqualizerCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    
    try {
        const queue = getQueue(message.guild.id);
        
        if (!queue || !queue.nowPlaying) {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '❌ कोई गाना नहीं चल रहा है!'
                    : '❌ No song is currently playing!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        const preset = args[0]?.toLowerCase();
        const validPresets = ['pop', 'rock', 'jazz', 'classical', 'electronic', 'reset'];
        
        if (!preset || !validPresets.includes(preset)) {
            const embed = new EmbedBuilder()
                .setTitle('🎛️ Equalizer Presets')
                .setDescription(lang === 'hi' 
                    ? `**Available presets:**\n• \`pop\` - Pop music के लिए\n• \`rock\` - Rock music के लिए\n• \`jazz\` - Jazz music के लिए\n• \`classical\` - Classical music के लिए\n• \`electronic\` - Electronic music के लिए\n• \`reset\` - Default settings\n\nExample: \`!eq pop\``
                    : `**Available presets:**\n• \`pop\` - For pop music\n• \`rock\` - For rock music\n• \`jazz\` - For jazz music\n• \`classical\` - For classical music\n• \`electronic\` - For electronic music\n• \`reset\` - Default settings\n\nExample: \`!eq pop\``)
                .setColor(config.COLORS.INFO);
            return await message.reply({ embeds: [embed] });
        }

        // Store EQ setting in queue (future implementation would apply actual audio filter)
        queue.eqPreset = preset;

        const embed = new EmbedBuilder()
            .setTitle('🎛️ Equalizer')
            .setDescription(lang === 'hi' 
                ? `✅ Equalizer को \`${preset}\` preset पर set कर दिया!\n\n❗ Audio equalizer आने वाले update में fully implement होगा।`
                : `✅ Equalizer set to \`${preset}\` preset!\n\n❗ Audio equalizer will be fully implemented in next update.`)
            .setColor(config.COLORS.SUCCESS);

        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Equalizer command error:', error);
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '⚠️ Equalizer settings में problem हुई!'
                : '⚠️ Failed to set equalizer!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Register slash commands
async function registerSlashCommands() {
    const commands = [
        {
            name: 'play',
            description: 'Play a song from YouTube, Spotify, or SoundCloud',
            options: [{
                type: 3, // STRING
                name: 'query',
                description: 'Song name or URL',
                required: true
            }]
        },
        {
            name: 'skip',
            description: 'Skip the current song'
        },
        {
            name: 'queue',
            description: 'Show the current music queue'
        },
        {
            name: 'volume',
            description: 'Set the music volume (0-100)',
            options: [{
                type: 4, // INTEGER
                name: 'level',
                description: 'Volume level (0-100)',
                required: true,
                min_value: 0,
                max_value: 100
            }]
        },
        {
            name: 'stop',
            description: 'Stop music and clear queue'
        }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('🔄 Refreshing application commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Application commands registered successfully!');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
}

// Handle slash commands
async function handleSlashCommand(interaction, guildSettings) {
    await interaction.deferReply();

    switch (interaction.commandName) {
        case 'play':
            const query = interaction.options.getString('query');
            await handlePlaySlashCommand(interaction, query, guildSettings);
            break;
        
        case 'skip':
            await handleSkipSlashCommand(interaction, guildSettings);
            break;
        
        case 'queue':
            await handleQueueSlashCommand(interaction, guildSettings);
            break;
        
        case 'volume':
            const volume = interaction.options.getInteger('level');
            await handleVolumeSlashCommand(interaction, volume, guildSettings);
            break;
        
        case 'stop':
            await handleStopSlashCommand(interaction, guildSettings);
            break;
    }
}

// Placeholder slash command handlers (implement similar to prefix commands)
async function handlePlaySlashCommand(interaction, query, guildSettings) {
    // Similar to handlePlayCommand but for slash commands
    const lang = guildSettings.language || 'hi';
    const messages = config.MESSAGES[lang];

    if (!interaction.member.voice.channel) {
        const embed = new EmbedBuilder()
            .setDescription(messages.NO_VOICE_CHANNEL)
            .setColor(config.COLORS.ERROR);
        return await interaction.editReply({ embeds: [embed] });
    }

    // Implementation similar to handlePlayCommand...
    await interaction.editReply('🎵 Playing your music! Use prefix commands for now - slash commands coming soon!');
}

// ==================== NEW PERFORMANCE-FOCUSED COMMANDS ====================

// Vote Skip Command - Democratic skipping
async function handleVoteSkipCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' ? 'कोई गाना नहीं चल रहा!' : 'No song is playing!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' ? 'Voice channel में join करें!' : 'Join a voice channel!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    const listeners = voiceChannel.members.filter(member => !member.user.bot).size;
    const votesNeeded = queue.getRequiredSkipVotes(listeners);
    const currentVotes = queue.addSkipVote(message.author.id);
    
    if (currentVotes >= votesNeeded) {
        queue.clearSkipVotes();
        await handleSkipCommand(message, guildSettings);
    } else {
        const embed = new EmbedBuilder()
            .setTitle('🗳️ Skip Vote Added!')
            .setDescription(lang === 'hi' 
                ? `Vote: **${currentVotes}/${votesNeeded}**\nSkip के लिए और votes चाहिए!`
                : `Votes: **${currentVotes}/${votesNeeded}**\nMore votes needed to skip!`)
            .setColor(config.COLORS.WARNING);
        await message.reply({ embeds: [embed] });
    }
}

// Enhanced Playlist Command
async function handlePlaylistCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (!args[0]) {
        // Show current playlist info if any
        if (queue.isPlaylist && queue.playlistInfo) {
            const embed = new EmbedBuilder()
                .setTitle('🎵 Current Playlist Info')
                .addFields(
                    { name: 'Name', value: queue.playlistInfo.name, inline: true },
                    { name: 'Author', value: queue.playlistInfo.author, inline: true },
                    { name: 'Tracks', value: `${queue.playlistInfo.trackCount}`, inline: true }
                )
                .setColor(config.COLORS.INFO);
            return await message.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setDescription(lang === 'hi' 
                    ? '🎵 Usage: !playlist <YouTube/Spotify playlist URL>'
                    : '🎵 Usage: !playlist <YouTube/Spotify playlist URL>')
                .setColor(config.COLORS.INFO);
            return await message.reply({ embeds: [embed] });
        }
    }
    
    const playlistUrl = args.join(' ');
    const playlistResult = await detectAndHandlePlaylist(playlistUrl, message.author);
    
    if (!playlistResult) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? '❌ Valid playlist URL नहीं मिला!'
                : '❌ Could not detect a valid playlist!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    try {
        queue.addBulk(playlistResult.tracks);
        queue.isPlaylist = true;
        queue.playlistInfo = playlistResult.playlistInfo;
        
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SUCCESS} Playlist Added!`)
            .setDescription(`Added **${playlistResult.tracks.length}** songs`)
            .addFields(
                { name: 'Playlist', value: playlistResult.playlistInfo.name, inline: true },
                { name: 'Author', value: playlistResult.playlistInfo.author, inline: true },
                { name: 'Queue Position', value: `${queue.size() - playlistResult.tracks.length + 1}-${queue.size()}`, inline: true }
            )
            .setColor(config.COLORS.SUCCESS)
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        
    } catch (error) {
        const embed = new EmbedBuilder()
            .setDescription(error.message)
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Skip to Position Command
async function handleSkipToCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' ? 'कोई गाना नहीं चल रहा!' : 'No song is playing!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    const position = parseInt(args[0]);
    if (!position || position < 1 || position > queue.size()) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? `Valid position दें (1-${queue.size()})`
                : `Please provide a valid position (1-${queue.size()})`)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    const skippedCount = position - 1;
    queue.songs.splice(0, skippedCount);
    
    const player = global.audioPlayers.get(message.guild.id);
    if (player) {
        player.stop();
    }
    
    const embed = new EmbedBuilder()
        .setTitle('⏭️ Skipped to Position')
        .setDescription(lang === 'hi' 
            ? `${skippedCount} गाने skip किए गए!`
            : `Skipped ${skippedCount} songs!`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

// Remove Song Command
async function handleRemoveCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (queue.isEmpty()) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' ? 'Queue empty है!' : 'Queue is empty!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    const position = parseInt(args[0]);
    if (!position || position < 1 || position > queue.size()) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? `Valid position दें (1-${queue.size()})`
                : `Please provide a valid position (1-${queue.size()})`)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    const removedSong = queue.songs.splice(position - 1, 1)[0];
    
    const embed = new EmbedBuilder()
        .setTitle('🗑️ Song Removed')
        .setDescription(`**${removedSong.info.title}** removed from queue`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

// Move Song Command
async function handleMoveCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (queue.isEmpty()) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' ? 'Queue empty है!' : 'Queue is empty!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    const from = parseInt(args[0]);
    const to = parseInt(args[1]);
    
    if (!from || !to || from < 1 || to < 1 || from > queue.size() || to > queue.size()) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' 
                ? `Usage: !move <from> <to> (1-${queue.size()})`
                : `Usage: !move <from> <to> (1-${queue.size()})`)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    const song = queue.songs.splice(from - 1, 1)[0];
    queue.songs.splice(to - 1, 0, song);
    
    const embed = new EmbedBuilder()
        .setTitle('📋 Song Moved')
        .setDescription(`**${song.info.title}** moved from position ${from} to ${to}`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

// Bass Boost Command
async function handleBassBoostCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' ? 'कोई गाना नहीं चल रहा!' : 'No song is playing!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    queue.bassBoost = !queue.bassBoost;
    
    const embed = new EmbedBuilder()
        .setTitle('🎵 Bass Boost')
        .setDescription(lang === 'hi' 
            ? `Bass Boost **${queue.bassBoost ? 'ON' : 'OFF'}** हो गया!`
            : `Bass Boost **${queue.bassBoost ? 'ON' : 'OFF'}**!`)
        .setColor(queue.bassBoost ? config.COLORS.SUCCESS : config.COLORS.ERROR);
    await message.reply({ embeds: [embed] });
}

// Filters Command
async function handleFiltersCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (!args[0]) {
        const filtersEmbed = new EmbedBuilder()
            .setTitle('🎛️ Available Filters')
            .setDescription(
                '**Available Filters:**\n' +
                '• `bass` - Bass boost\n' +
                '• `clear` - Clear all filters\n' +
                '• `nightcore` - Nightcore effect\n' +
                '• `vaporwave` - Vaporwave effect\n\n' +
                '**Usage:** `!filters <filter>`'
            )
            .setColor(config.COLORS.INFO);
        return await message.reply({ embeds: [filtersEmbed] });
    }
    
    const filter = args[0].toLowerCase();
    
    switch (filter) {
        case 'clear':
            queue.filters.clear();
            queue.bassBoost = false;
            queue.nightcore = false;
            break;
        case 'bass':
            queue.bassBoost = !queue.bassBoost;
            break;
        case 'nightcore':
            queue.nightcore = !queue.nightcore;
            break;
        default:
            return await message.reply('❌ Invalid filter! Use `!filters` to see available filters.');
    }
    
    const embed = new EmbedBuilder()
        .setTitle('🎛️ Filters Updated')
        .setDescription(`Filter **${filter}** applied!`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

// History Command
async function handleHistoryCommand(message, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (queue.history.length === 0) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' ? 'History empty है!' : 'History is empty!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    let description = '';
    queue.history.slice(0, 10).forEach((track, index) => {
        description += `${index + 1}. **${track.info.title}** - ${track.info.author}\n`;
    });
    
    const embed = new EmbedBuilder()
        .setTitle('📜 Recently Played')
        .setDescription(description)
        .setColor(config.COLORS.INFO)
        .setFooter({ text: `Showing last ${Math.min(queue.history.length, 10)} songs` });
    
    await message.reply({ embeds: [embed] });
}

// Speed/Tempo Command  
async function handleSpeedCommand(message, args, guildSettings) {
    const lang = guildSettings?.language || 'hi';
    const queue = getQueue(message.guild.id);
    
    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription(lang === 'hi' ? 'कोई गाना नहीं चल रहा!' : 'No song is playing!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (!args[0]) {
        const embed = new EmbedBuilder()
            .setDescription('Usage: !speed <0.5-2.0>\nExample: `!speed 1.25`')
            .setColor(config.COLORS.INFO);
        return await message.reply({ embeds: [embed] });
    }
    
    const speed = parseFloat(args[0]);
    if (speed < 0.5 || speed > 2.0) {
        const embed = new EmbedBuilder()
            .setDescription('Speed must be between 0.5 and 2.0!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    queue.filters.set('speed', speed);
    
    const embed = new EmbedBuilder()
        .setTitle('⚡ Speed Changed')
        .setDescription(`Playback speed set to **${speed}x**`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

// Seek Command
async function handleSeekCommand(message, args, guildSettings) {
    const embed = new EmbedBuilder()
        .setTitle('⏱️ Seek Command')
        .setDescription('Seek feature is coming soon!\nCurrently working with fallback player limitations.')
        .setColor(config.COLORS.INFO);
    await message.reply({ embeds: [embed] });
}

// Startup cleanup function
function performStartupCleanup() {
    try {
        const fs = require('fs');
        const path = require('path');
        
        // Clean up any existing HTML garbage files
        const files = fs.readdirSync('.');
        const htmlFiles = files.filter(f => f.includes('watch') && f.endsWith('.html'));
        
        if (htmlFiles.length > 0) {
            htmlFiles.forEach(file => {
                try {
                    fs.unlinkSync(file);
                    console.log(`🧹 Startup cleanup: removed ${file}`);
                } catch (err) {
                    console.log(`Warning: Could not delete ${file}`);
                }
            });
            console.log(`🧹 Startup cleanup completed: removed ${htmlFiles.length} garbage files`);
        }
    } catch (error) {
        console.log('Startup cleanup warning:', error.message);
    }
}

// Enhanced Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't crash the bot, just log
});

process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    // Set lavalink unavailable if it's a lavalink error
    if (error.message && error.message.includes('Lavalink')) {
        lavalinkAvailable = false;
        console.log('🎵 Switching to fallback mode due to Lavalink error');
    }
    // Don't exit the process for music bot errors
});

// Login
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is required! Please set it in your environment variables.');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);