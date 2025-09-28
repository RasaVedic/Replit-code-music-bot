const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { LavalinkManager } = require('lavalink-client');
const ytdl = require('@distube/ytdl-core');
const play = require('play-dl');
const YouTube = require('youtube-sr').default;
const { getCachedSearchResults } = require('../utils/CacheManager');
const { toUnifiedTrack, createNowPlayingEmbed } = require('../utils/TrackHelpers');
const { getGuildSettings } = require('./database');
const config = require('../config/botConfig');

// Lavalink Manager - will be initialized after bot is ready
let lavalinkManager = null;
let lavalinkAvailable = false;

// Lavalink configuration
const lavalinkConfig = {
    nodes: [
        {
            authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass",
            host: process.env.LAVALINK_HOST || "localhost",
            port: parseInt(process.env.LAVALINK_PORT) || 2333,
            id: "main_node"
        }
    ],
    sendToShard: (guildId, payload) => global.client?.guilds.cache.get(guildId)?.shard?.send(payload),
    client: {
        id: process.env.CLIENT_ID || global.client?.user?.id,
        username: process.env.BOT_NAME || "EchoTune"
    }
};

// Initialize Lavalink
function initializeLavalink(client) {
    try {
        lavalinkManager = new LavalinkManager({
            nodes: lavalinkConfig.nodes,
            sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
            client: {
                id: client.user.id,
                username: client.user.username
            }
        });
        
        setupLavalinkEvents();
        lavalinkAvailable = true;
        console.log('🎵 Lavalink manager initialized successfully');
        return true;
    } catch (error) {
        console.log('⚠️ Lavalink initialization failed, using fallback:', error.message);
        lavalinkAvailable = false;
        return false;
    }
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
            setTimeout(() => cleanupFallbackPlayer(guildId), 100);
        });

        connection.on(VoiceConnectionStatus.Destroyed, () => {
            console.log(`💥 Voice connection destroyed for guild ${guildId}`);
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
            const queue = global.getQueue(guildId);
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
        
        // Enhanced headers with rotating user agents
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
        
        const enhancedHeaders = {
            'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive'
        };

        // Retry mechanism for YouTube streaming
        while (attempts < maxAttempts && !stream) {
            attempts++;
            
            if (track.url && (track.url.includes('youtube.com') || track.url.includes('youtu.be'))) {
                try {
                    await play.setToken({
                        useragent: [enhancedHeaders['User-Agent']]
                    });
                    
                    stream = await play.stream(track.url, {
                        quality: 2,
                        discordPlayerCompatibility: true
                    });
                    console.log(`[${guildId}] Playing with play-dl (attempt ${attempts}): ${track.title}`);
                    break;
                } catch (error) {
                    console.log(`[${guildId}] play-dl failed (attempt ${attempts}: ${error.message})`);
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                    }
                }
            }
            
            // Fallback to ytdl-core
            if (!stream && attempts === maxAttempts) {
                try {
                    stream = ytdl(track.url, {
                        filter: 'audioonly',
                        quality: 'highestaudio',
                        highWaterMark: 1 << 25,
                        requestOptions: { headers: enhancedHeaders }
                    });
                    console.log(`[${guildId}] Playing with ytdl-core (attempt ${attempts}): ${track.title}`);
                    break;
                } catch (error) {
                    console.log(`[${guildId}] ytdl-core failed (attempt ${attempts}): ${error.message}`);
                }
            }
        }

        if (!stream) {
            console.error(`[${guildId}] All streaming methods failed for: ${track.title}`);
            return false;
        }

        const resource = createAudioResource(stream, {
            inputType: stream.type,
            inlineVolume: true
        });
        
        const queue = global.getQueue(guildId);
        if (resource.volume) {
            resource.volume.setVolume(queue.volume / 100);
        }

        player.play(resource);
        return true;

    } catch (error) {
        console.error(`[${guildId}] Playback error:`, error.message);
        return false;
    }
}

// Handle track end for fallback player
async function handleFallbackTrackEnd(guildId) {
    const queue = global.getQueue(guildId);
    
    if (queue.loop && queue.nowPlaying) {
        // Loop current song
        await playFallbackTrack(guildId, queue.nowPlaying);
        return;
    }

    const nextTrack = queue.next();
    
    if (nextTrack) {
        const unifiedTrack = toUnifiedTrack(nextTrack, 'fallback');
        queue.nowPlaying = unifiedTrack;
        
        const success = await playFallbackTrack(guildId, nextTrack);
        if (success && queue.textChannel) {
            try {
                const guildSettings = getGuildSettings(guildId);
                const nowPlayingMessage = createNowPlayingEmbed(unifiedTrack, queue, guildSettings);
                await queue.textChannel.send(nowPlayingMessage);
            } catch (error) {
                console.log('Could not send now playing message:', error.message);
            }
        }
    } else if (queue.autoplay && queue.nowPlaying) {
        // Try autoplay
        const suggestion = await getAutoPlaySuggestion(queue.nowPlaying);
        if (suggestion) {
            queue.add(suggestion);
            const nextSong = queue.next();
            if (nextSong) {
                queue.nowPlaying = nextSong;
                await playFallbackTrack(guildId, nextSong);
            }
        } else {
            queue.clear();
            cleanupFallbackPlayer(guildId);
        }
    } else {
        queue.clear();
        cleanupFallbackPlayer(guildId);
    }
}

// Auto play suggestions
async function getAutoPlaySuggestion(lastTrack) {
    try {
        const searchQuery = `${lastTrack.info.author} similar songs`;
        const results = await getCachedSearchResults(searchQuery, 5);
        
        if (results.length > 1) {
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

// Cleanup fallback player
function cleanupFallbackPlayer(guildId) {
    try {
        const player = global.audioPlayers.get(guildId);
        const connection = global.connections.get(guildId);
        
        if (player) {
            try {
                player.stop();
                global.audioPlayers.delete(guildId);
            } catch (error) {
                console.log(`Player cleanup warning: ${error.message}`);
            }
        }
        
        if (connection) {
            try {
                if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                }
                global.connections.delete(guildId);
            } catch (error) {
                console.log(`Connection cleanup warning: ${error.message}`);
                global.connections.delete(guildId);
            }
        }
        
        const queue = global.getQueue(guildId);
        if (queue) {
            queue.clear();
            global.queues.delete(guildId);
        }
        
        console.log(`🧹 Cleaned up player resources for guild ${guildId}`);
    } catch (error) {
        console.error('Cleanup error:', error.message);
    }
}

// Error notification
function notifyStreamingError(guildId, errorType) {
    const queue = global.getQueue(guildId);
    if (!queue || !queue.textChannel) return;
    
    const errorMessages = {
        'youtube_blocked': '⚠️ YouTube blocked the request. Trying alternative method...',
        'general_error': '⚠️ Streaming error occurred. Trying next song...'
    };
    
    const message = errorMessages[errorType] || errorMessages['general_error'];
    
    try {
        queue.textChannel.send(message).catch(() => {});
    } catch (error) {
        console.log('Could not send error notification:', error.message);
    }
}

// Setup Lavalink Events
function setupLavalinkEvents() {
    if (!lavalinkManager) return;
    
    lavalinkManager.on('trackStart', async (player, track) => {
        const queue = global.getQueue(player.guildId);
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
        const queue = global.getQueue(player.guildId);
        
        if (queue.loop) {
            await player.play({ track: track.encoded });
            return;
        }

        const nextTrack = queue.next();
        
        if (nextTrack) {
            await player.play({ track: nextTrack.encoded });
        } else if (queue.autoplay && track) {
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
        const queue = global.getQueue(player.guildId);
        if (queue.textChannel) {
            const { EmbedBuilder } = require('discord.js');
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
        
        setTimeout(() => {
            if (queue.isEmpty()) {
                player.destroy();
                global.queues.delete(player.guildId);
            }
        }, 30000);
    });
}

module.exports = {
    initializeLavalink,
    createFallbackPlayer,
    playFallbackTrack,
    handleFallbackTrackEnd,
    cleanupFallbackPlayer,
    getAutoPlaySuggestion,
    setupLavalinkEvents,
    get lavalinkManager() { return lavalinkManager; },
    get lavalinkAvailable() { return lavalinkAvailable; }
};