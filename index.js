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

// Global queue management
global.queues = new Map();
global.players = new Map();
global.audioPlayers = new Map();
global.connections = new Map();

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

// Create commands directory if it doesn't exist
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath, { recursive: true });
}

// Enhanced Music Queue Class
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
}

// Get or create queue
function getQueue(guildId) {
    if (!global.queues.has(guildId)) {
        global.queues.set(guildId, new EnhancedMusicQueue(guildId));
    }
    return global.queues.get(guildId);
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

// Auto play suggestions
async function getAutoPlaySuggestion(lastTrack) {
    try {
        const searchQuery = `${lastTrack.info.author} similar songs`;
        const result = await lavalinkManager.search({
            query: searchQuery,
            source: config.SOURCES.YOUTUBE
        }, lastTrack.requester);

        if (result.tracks.length > 1) {
            // Return a random track from results (excluding the first which might be the same)
            const randomIndex = Math.floor(Math.random() * Math.min(result.tracks.length - 1, 5)) + 1;
            return result.tracks[randomIndex];
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

        // Handle connection state changes
        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🔌 Voice connection disconnected for guild ${guildId}`);
            cleanupFallbackPlayer(guildId);
        });

        connection.on(VoiceConnectionStatus.Destroyed, () => {
            console.log(`💥 Voice connection destroyed for guild ${guildId}`);
            cleanupFallbackPlayer(guildId);
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
        
        // Try play-dl first
        if (track.url && (track.url.includes('youtube.com') || track.url.includes('youtu.be'))) {
            try {
                stream = await play.stream(track.url);
                console.log(`[${guildId}] Playing with play-dl: ${track.title}`);
            } catch (error) {
                console.log(`[${guildId}] play-dl failed, trying ytdl-core...`);
            }
        }

        // Try ytdl-core as fallback
        if (!stream && track.url) {
            try {
                stream = ytdl(track.url, {
                    filter: 'audioonly',
                    quality: 'highestaudio',
                    highWaterMark: 1 << 25,
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Cookie': process.env.YOUTUBE_COOKIE || ''
                        }
                    }
                });
                console.log(`[${guildId}] Playing with ytdl-core: ${track.title}`);
            } catch (error) {
                console.log(`[${guildId}] ytdl-core failed: ${error.message}`);
                return false;
            }
        }

        if (!stream) return false;

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
        return false;
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

// Cleanup fallback player resources
function cleanupFallbackPlayer(guildId) {
    const player = global.audioPlayers.get(guildId);
    const connection = global.connections.get(guildId);
    
    if (player) {
        player.stop();
        global.audioPlayers.delete(guildId);
    }
    
    if (connection) {
        connection.destroy();
        global.connections.delete(guildId);
    }
    
    const queue = getQueue(guildId);
    queue.clear();
    global.queues.delete(guildId);
    
    console.log(`🧹 Cleaned up fallback player for guild ${guildId}`);
}

// Auto-cleanup idle players
function setupIdleCleanup() {
    setInterval(() => {
        for (const [guildId, queue] of global.queues.entries()) {
            if (!queue.nowPlaying && queue.isEmpty()) {
                // Check if player has been idle for 5 minutes
                const lastActivity = queue.lastActivity || Date.now();
                if (Date.now() - lastActivity > 5 * 60 * 1000) {
                    console.log(`🧹 Auto-cleaning up idle player for guild ${guildId}`);
                    cleanupFallbackPlayer(guildId);
                }
            }
        }
    }, 60000); // Check every minute
}

// Bot Events
client.on('ready', async () => {
    console.log(`🎵 ${client.user.username} music bot is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);

    try {
        // Initialize Lavalink Manager after client is ready
        lavalinkManager = new LavalinkManager({
            nodes: [
                {
                    authorization: process.env.LAVALINK_PASSWORD || config.LAVALINK.PASSWORD,
                    host: process.env.LAVALINK_HOST || config.LAVALINK.HOST,
                    port: parseInt(process.env.LAVALINK_PORT) || config.LAVALINK.PORT,
                    id: config.LAVALINK.IDENTIFIER,
                }
            ],
            sendToShard: (guildId, payload) => {
                const guild = client.guilds.cache.get(guildId);
                if (guild?.shard) {
                    guild.shard.send(payload);
                } else if (client.ws) {
                    client.ws.send(payload);
                }
            },
            autoSkip: true,
            client: {
                id: client.user.id,
                username: client.user.username
            },
        });

        // Add comprehensive error handlers for Lavalink
        lavalinkManager.on('nodeError', (node, error) => {
            console.error(`❌ Lavalink node error: ${error.message}`);
            lavalinkAvailable = false;
        });

        lavalinkManager.on('nodeDisconnect', (node) => {
            console.log(`🔌 Lavalink node disconnected: ${node.options.id}`);
            lavalinkAvailable = false;
        });

        lavalinkManager.on('nodeConnect', (node) => {
            console.log(`🔗 Lavalink node connected: ${node.options.id}`);
            lavalinkAvailable = true;
        });

        lavalinkManager.on('error', (error) => {
            console.error(`❌ Lavalink manager error: ${error.message}`);
            lavalinkAvailable = false;
        });

        // Add NodeManager error handler to prevent ERR_UNHANDLED_ERROR
        lavalinkManager.nodeManager.on('error', (error) => {
            console.error(`❌ Lavalink NodeManager error: ${error.message}`);
            lavalinkAvailable = false;
        });

        // Initialize Lavalink
        await lavalinkManager.init(client.user);
        // Don't set lavalinkAvailable = true here, wait for nodeConnect event
        console.log('🔗 Lavalink Manager initialized successfully!');
        
        // Setup Lavalink events
        setupLavalinkEvents();
        
    } catch (error) {
        console.error('⚠️ Lavalink initialization failed:', error.message);
        console.log('🎵 Bot will use fallback streaming methods...');
        lavalinkAvailable = false;
    }

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
        case 'st':
            await handleStopCommand(message, guildSettings);
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
    const lang = guildSettings.language || 'hi';
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
        // Search using YouTube SR
        let results;
        
        if (ytdl.validateURL(query)) {
            // Direct URL
            try {
                const info = await ytdl.getInfo(query);
                results = [{
                    title: info.videoDetails.title,
                    author: info.videoDetails.author.name,
                    url: query,
                    duration: parseInt(info.videoDetails.lengthSeconds),
                    thumbnail: info.videoDetails.thumbnails[0]?.url,
                }];
            } catch (error) {
                console.log('ytdl getInfo failed, trying search...');
                results = await YouTube.search(query, { limit: 1 });
            }
        } else {
            // Search query
            results = await YouTube.search(query, { limit: 1 });
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
            connection.destroy();
            global.connections.delete(message.guild.id);
        }
    }

    queue.clear();
    global.queues.delete(message.guild.id);

    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.STOP} ${messages.MUSIC_STOPPED}`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
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
                      `\`${prefix}stop\` \`${prefix}st\` - Stop music\n` +
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