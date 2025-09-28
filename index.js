const { Client, Collection, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
const play = require('play-dl');
const scdl = require('soundcloud-downloader').default;
const { getYouTubeUrlFromSpotify, searchSpotifyPlaylist } = require('./spotify.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Bot configuration
const PREFIX = '!';
const MAX_QUEUE_SIZE = 100;
const DEFAULT_VOLUME = 0.5;

// Music queue system
const musicQueues = new Map();
const audioPlayers = new Map();

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

// Create commands directory if it doesn't exist
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath);
}

// Load command files
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    client.commands.set(command.data.name, command);
}

// Music utility functions
class MusicQueue {
    constructor(guildId) {
        this.guildId = guildId;
        this.songs = [];
        this.nowPlaying = null;
        this.volume = DEFAULT_VOLUME;
        this.loop = false;
        this.autoplay = false;
        this.shuffled = false;
        this.history = [];
    }

    add(song) {
        if (this.songs.length >= MAX_QUEUE_SIZE) {
            throw new Error(`Queue is full! Maximum ${MAX_QUEUE_SIZE} songs allowed.`);
        }
        this.songs.push(song);
    }

    next() {
        if (this.loop && this.nowPlaying) {
            return this.nowPlaying;
        }
        if (this.nowPlaying) {
            this.history.push(this.nowPlaying);
            if (this.history.length > 10) {
                this.history.shift();
            }
        }
        return this.songs.shift();
    }

    previous() {
        if (this.history.length > 0) {
            if (this.nowPlaying) {
                this.songs.unshift(this.nowPlaying);
            }
            return this.history.pop();
        }
        return null;
    }

    shuffle() {
        for (let i = this.songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
        }
        this.shuffled = true;
    }

    clear() {
        this.songs = [];
        this.nowPlaying = null;
        this.history = [];
    }

    isEmpty() {
        return this.songs.length === 0;
    }

    getPosition(song) {
        return this.songs.findIndex(s => s.url === song.url) + 1;
    }
}

function getQueue(guildId) {
    if (!musicQueues.has(guildId)) {
        musicQueues.set(guildId, new MusicQueue(guildId));
    }
    return musicQueues.get(guildId);
}

// Helper functions for different music sources
async function getTrackFromUrl(url, requestedBy) {
    try {
        // Detect source type
        if (url.includes('spotify.com')) {
            return await getSpotifyTrack(url, requestedBy);
        } else if (url.includes('soundcloud.com')) {
            return await getSoundCloudTrack(url, requestedBy);
        } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
            return await getYouTubeTrack(url, requestedBy);
        } else {
            throw new Error('Unsupported URL format');
        }
    } catch (error) {
        console.error('Error getting track from URL:', error);
        throw error;
    }
}

async function getSpotifyTrack(spotifyUrl, requestedBy) {
    try {
        const spotifyInfo = await getYouTubeUrlFromSpotify(spotifyUrl);
        const searchResults = await YouTube.search(spotifyInfo.searchQuery, { limit: 1, type: 'video' });
        
        if (searchResults.length === 0) {
            throw new Error('No YouTube equivalent found for Spotify track');
        }
        
        return {
            title: spotifyInfo.title,
            artist: spotifyInfo.artist,
            url: searchResults[0].url,
            duration: spotifyInfo.duration,
            thumbnail: spotifyInfo.thumbnail,
            source: 'spotify',
            spotifyUrl: spotifyInfo.spotifyUrl,
            requestedBy
        };
    } catch (error) {
        throw new Error(`Spotify track error: ${error.message}`);
    }
}

async function getSoundCloudTrack(soundcloudUrl, requestedBy) {
    try {
        const info = await scdl.getInfo(soundcloudUrl);
        return {
            title: info.title,
            artist: info.user.username,
            url: soundcloudUrl,
            duration: Math.floor(info.duration / 1000),
            thumbnail: info.artwork_url,
            source: 'soundcloud',
            requestedBy
        };
    } catch (error) {
        throw new Error(`SoundCloud track error: ${error.message}`);
    }
}

async function getYouTubeTrack(youtubeUrl, requestedBy) {
    try {
        let title, duration, thumbnail;
        
        try {
            const videoInfo = await play.video_info(youtubeUrl);
            title = videoInfo.video_details.title;
            duration = videoInfo.video_details.durationInSec;
            thumbnail = videoInfo.video_details.thumbnails[0]?.url;
        } catch (playDlError) {
            const videoId = youtubeUrl.split('v=')[1]?.split('&')[0];
            if (videoId) {
                const searchResult = await YouTube.getVideo(youtubeUrl);
                title = searchResult.title;
                duration = searchResult.duration;
                thumbnail = searchResult.thumbnail?.url;
            } else {
                throw new Error('Unable to extract video info');
            }
        }
        
        return {
            title,
            url: youtubeUrl,
            duration,
            thumbnail,
            source: 'youtube',
            requestedBy
        };
    } catch (error) {
        throw new Error(`YouTube track error: ${error.message}`);
    }
}

// Command shortcuts mapping
const COMMAND_SHORTCUTS = {
    'p': 'play',
    'pl': 'playlist', 
    's': 'skip',
    'st': 'stop',
    'ps': 'pause',
    'r': 'resume',
    'v': 'volume',
    'q': 'queue',
    'np': 'nowplaying',
    'l': 'loop',
    'h': 'help',
    'j': 'join',
    'lv': 'leave',
    'sh': 'shuffle',
    'ap': 'autoplay'
};

// Audio player setup
function createGuildAudioPlayer(guildId) {
    if (audioPlayers.has(guildId)) {
        return audioPlayers.get(guildId);
    }

    const player = createAudioPlayer();
    audioPlayers.set(guildId, player);

    player.on(AudioPlayerStatus.Playing, () => {
        console.log(`[${guildId}] Audio player started playing`);
    });

    player.on(AudioPlayerStatus.Idle, () => {
        console.log(`[${guildId}] Audio player finished playing`);
        const queue = getQueue(guildId);
        playNext(guildId);
    });

    player.on('error', error => {
        console.error(`[${guildId}] Audio player error:`, error);
        const queue = getQueue(guildId);
        queue.nowPlaying = null;
        
        // Try to play next song after error
        if (!queue.isEmpty()) {
            setTimeout(() => playNext(guildId), 2000);
        }
    });

    return player;
}

async function playNext(guildId) {
    const queue = getQueue(guildId);
    const player = audioPlayers.get(guildId);

    if (!player) return;

    let nextSong = queue.next();
    
    // If queue is empty and autoplay is enabled, get an autoplay track
    if (!nextSong && queue.autoplay && queue.nowPlaying) {
        console.log(`[${guildId}] Queue empty, trying autoplay...`);
        const autoplayTrack = await getAutoplayTrack(queue.nowPlaying);
        if (autoplayTrack) {
            queue.add(autoplayTrack);
            nextSong = queue.next();
            console.log(`[${guildId}] Added autoplay track: ${autoplayTrack.title}`);
        }
    }
    
    if (!nextSong) {
        queue.nowPlaying = null;
        console.log(`[${guildId}] Queue finished, no more songs to play`);
        return;
    }

    queue.nowPlaying = nextSong;
    console.log(`[${guildId}] Playing: ${nextSong.title}`);

    // Try multiple methods to get the audio stream based on source
    let stream = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (!stream && retryCount < maxRetries) {
        try {
            if (nextSong.source === 'soundcloud') {
                console.log(`[${guildId}] Streaming from SoundCloud...`);
                stream = await scdl.download(nextSong.url, { quality: 'mp3' });
                nextSong.streamType = 'arbitrary';
            } else {
                // YouTube source (including Spotify converted to YouTube)
                if (retryCount === 0) {
                    // Try play-dl first (more reliable)
                    console.log(`[${guildId}] Trying play-dl...`);
                    
                    // Skip token refresh as it's causing issues
                    // play-dl will handle tokens internally
                    
                    const streamInfo = await play.stream(nextSong.url, { 
                        quality: 2,
                        filter: 'audioonly',
                    });
                    
                    // Store both stream and type for proper resource creation
                    stream = streamInfo.stream;
                    nextSong.streamType = streamInfo.type;
                } else {
                    // Fallback to ytdl-core with updated options
                    console.log(`[${guildId}] Trying ytdl-core...`);
                    stream = ytdl(nextSong.url, {
                        filter: 'audioonly',
                        quality: 'highestaudio',
                        highWaterMark: 1 << 25,
                        requestOptions: {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            }
                        },
                    });
                }
            }
        } catch (error) {
            console.error(`[${guildId}] Attempt ${retryCount + 1} failed:`, error.message);
            retryCount++;
            
            if (retryCount >= maxRetries) {
                console.error(`[${guildId}] All attempts failed for: ${nextSong.title}`);
                queue.nowPlaying = null;
                
                // Skip to next song if available
                if (!queue.isEmpty()) {
                    setTimeout(() => playNext(guildId), 1000);
                }
                return;
            }
            
            // Exponential backoff: 1s, 2s, 4s
            const delayMs = Math.pow(2, retryCount) * 1000;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    if (stream) {
        try {
            const resourceOptions = {
                metadata: nextSong,
                inlineVolume: true
            };
            
            // Set input type if available (from play-dl)
            if (nextSong.streamType) {
                resourceOptions.inputType = nextSong.streamType;
            }
            
            const resource = createAudioResource(stream, resourceOptions);

            // Set initial volume
            if (resource.volume) {
                resource.volume.setVolume(queue.volume);
            }

            player.play(resource);
            console.log(`[${guildId}] Successfully started playing: ${nextSong.title}`);
        } catch (error) {
            console.error(`[${guildId}] Error creating audio resource:`, error);
            queue.nowPlaying = null;
            
            // Skip to next song if available
            if (!queue.isEmpty()) {
                setTimeout(() => playNext(guildId), 1000);
            }
        }
    }
}

// Create interactive control buttons
function createControlButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_pause')
                .setLabel('⏸️ Pause')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setLabel('⏭️ Skip')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_stop')
                .setLabel('⏹️ Stop')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('music_shuffle')
                .setLabel('🔀 Shuffle')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_queue')
                .setLabel('📋 Queue')
                .setStyle(ButtonStyle.Secondary)
        );
}

function createVolumeButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('volume_down')
                .setLabel('🔉 Vol-')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('volume_up')
                .setLabel('🔊 Vol+')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_loop')
                .setLabel('🔁 Loop')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_autoplay')
                .setLabel('🎵 AutoPlay')
                .setStyle(ButtonStyle.Secondary)
        );
}

// Auto-play functionality
async function getAutoplayTrack(lastTrack) {
    try {
        if (!lastTrack || lastTrack.source !== 'youtube') return null;
        
        // Search for related videos
        const searchQuery = `${lastTrack.title} similar music`;
        const results = await YouTube.search(searchQuery, { limit: 5, type: 'video' });
        
        if (results.length > 0) {
            // Pick a random result (not the same as the last track)
            const filtered = results.filter(video => video.url !== lastTrack.url);
            if (filtered.length > 0) {
                const randomTrack = filtered[Math.floor(Math.random() * filtered.length)];
                return {
                    title: randomTrack.title,
                    url: randomTrack.url,
                    duration: randomTrack.duration,
                    thumbnail: randomTrack.thumbnail?.url,
                    source: 'youtube',
                    autoplay: true,
                    requestedBy: { username: 'AutoPlay', tag: 'AutoPlay#0000' }
                };
            }
        }
        return null;
    } catch (error) {
        console.error('Autoplay error:', error);
        return null;
    }
}

// Prefix command handler
async function handlePrefixCommand(message, commandName, args) {
    const guildId = message.guild.id;
    const member = message.member;
    const voiceChannel = member?.voice?.channel;
    
    switch (commandName) {
        case 'play':
        case 'p':
            if (!args[0]) return message.reply('❌ Please provide a song name, URL, or search query!');
            if (!voiceChannel) return message.reply('❌ आपको पहले किसी voice channel में join करना होगा!');
            
            await handlePlayCommand(message, args.join(' '), voiceChannel);
            break;
            
        case 'skip':
        case 's':
            await handleSkipCommand(message);
            break;
            
        case 'stop':
        case 'st':
            await handleStopCommand(message);
            break;
            
        case 'pause':
        case 'ps':
            await handlePauseCommand(message);
            break;
            
        case 'resume':
        case 'r':
            await handleResumeCommand(message);
            break;
            
        case 'volume':
        case 'v':
            const volume = parseInt(args[0]);
            await handleVolumeCommand(message, volume);
            break;
            
        case 'queue':
        case 'q':
            await handleQueueCommand(message);
            break;
            
        case 'nowplaying':
        case 'np':
            await handleNowPlayingCommand(message);
            break;
            
        case 'loop':
        case 'l':
            await handleLoopCommand(message);
            break;
            
        case 'shuffle':
        case 'sh':
            await handleShuffleCommand(message);
            break;
            
        case 'autoplay':
        case 'ap':
            await handleAutoplayCommand(message);
            break;
            
        case 'help':
        case 'h':
            await handleHelpCommand(message);
            break;
            
        case 'join':
        case 'j':
            if (!voiceChannel) return message.reply('❌ आपको पहले किसी voice channel में join करना होगा!');
            await handleJoinCommand(message, voiceChannel);
            break;
            
        case 'leave':
        case 'lv':
            await handleLeaveCommand(message);
            break;
            
        default:
            message.reply(`❌ Unknown command: \`${commandName}\`. Use \`${PREFIX}help\` for available commands.`);
    }
}

// Prefix command implementations
async function handlePlayCommand(message, query, voiceChannel) {
    try {
        let track;
        
        // Check if it's a URL
        if (query.includes('http')) {
            track = await getTrackFromUrl(query, message.author);
        } else {
            // Search YouTube
            const results = await YouTube.search(query, { limit: 1, type: 'video' });
            if (results.length === 0) {
                return message.reply('❌ No results found!');
            }
            track = await getYouTubeTrack(results[0].url, message.author);
        }
        
        // Join voice channel
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        
        const queue = getQueue(message.guild.id);
        const player = createGuildAudioPlayer(message.guild.id);
        connection.subscribe(player);
        
        if (queue.nowPlaying) {
            queue.add(track);
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📋 Added to Queue')
                .setDescription(`**${track.title}**\nPosition: ${queue.songs.length}`)
                .setThumbnail(track.thumbnail);
            
            message.reply({ embeds: [embed], components: [createControlButtons()] });
        } else {
            queue.add(track);
            playNext(message.guild.id);
            
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🎵 Now Playing')
                .setDescription(`**${track.title}**`)
                .setThumbnail(track.thumbnail);
            
            message.reply({ embeds: [embed], components: [createControlButtons(), createVolumeButtons()] });
        }
        
    } catch (error) {
        console.error('Play command error:', error);
        message.reply(`❌ Error: ${error.message}`);
    }
}

async function handleHelpCommand(message) {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🎵 Music Bot Commands')
        .setDescription('All available commands with shortcuts')
        .addFields(
            {
                name: '🎵 Music Controls',
                value: `\`${PREFIX}play (!p)\` - Play a song\n\`${PREFIX}skip (!s)\` - Skip current song\n\`${PREFIX}stop (!st)\` - Stop playback\n\`${PREFIX}pause (!ps)\` - Pause playback\n\`${PREFIX}resume (!r)\` - Resume playback`,
                inline: true
            },
            {
                name: '🔊 Volume & Settings',
                value: `\`${PREFIX}volume (!v)\` - Set volume (1-100)\n\`${PREFIX}loop (!l)\` - Toggle loop mode\n\`${PREFIX}shuffle (!sh)\` - Shuffle queue\n\`${PREFIX}autoplay (!ap)\` - Toggle autoplay`,
                inline: true
            },
            {
                name: '📋 Queue & Info',
                value: `\`${PREFIX}queue (!q)\` - Show queue\n\`${PREFIX}nowplaying (!np)\` - Current song info\n\`${PREFIX}join (!j)\` - Join voice channel\n\`${PREFIX}leave (!lv)\` - Leave voice channel`,
                inline: true
            },
            {
                name: '🎶 Supported Sources',
                value: '• YouTube URLs & Search\n• Spotify URLs & Playlists\n• SoundCloud URLs',
                inline: false
            }
        )
        .setFooter({ text: 'Use interactive buttons for quick controls!' });
    
    message.reply({ embeds: [embed] });
}

// Simple implementations for other commands
async function handleSkipCommand(message) {
    const queue = getQueue(message.guild.id);
    const player = audioPlayers.get(message.guild.id);
    
    if (!queue.nowPlaying) {
        return message.reply('❌ No song is currently playing!');
    }
    
    if (player) {
        player.stop();
    }
    
    message.reply('⏭️ Skipped current song!');
}

async function handleStopCommand(message) {
    const queue = getQueue(message.guild.id);
    const player = audioPlayers.get(message.guild.id);
    
    if (player) {
        player.stop();
        queue.clear();
        message.reply('⏹️ Stopped and cleared queue!');
    } else {
        message.reply('❌ Nothing is playing!');
    }
}

async function handlePauseCommand(message) {
    const queue = getQueue(message.guild.id);
    const player = audioPlayers.get(message.guild.id);
    
    if (player && queue.nowPlaying) {
        player.pause();
        message.reply('⏸️ Paused!');
    } else {
        message.reply('❌ Nothing is playing!');
    }
}

async function handleResumeCommand(message) {
    const queue = getQueue(message.guild.id);
    const player = audioPlayers.get(message.guild.id);
    
    if (player && queue.nowPlaying) {
        player.unpause();
        message.reply('▶️ Resumed!');
    } else {
        message.reply('❌ Nothing is paused!');
    }
}

async function handleVolumeCommand(message, volume) {
    if (isNaN(volume) || volume < 1 || volume > 100) {
        return message.reply('❌ Please provide a volume between 1-100!');
    }
    
    const queue = getQueue(message.guild.id);
    queue.volume = volume / 100;
    
    message.reply(`🔊 Volume set to ${volume}%!`);
}

async function handleQueueCommand(message) {
    const queue = getQueue(message.guild.id);
    
    if (queue.isEmpty() && !queue.nowPlaying) {
        return message.reply('❌ Queue is empty!');
    }
    
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📋 Current Queue');
    
    let description = '';
    
    if (queue.nowPlaying) {
        description += `**Now Playing:**\n🎵 ${queue.nowPlaying.title}\n\n`;
    }
    
    if (queue.songs.length > 0) {
        description += '**Up Next:**\n';
        queue.songs.slice(0, 10).forEach((song, index) => {
            description += `${index + 1}. ${song.title}\n`;
        });
        
        if (queue.songs.length > 10) {
            description += `\n... and ${queue.songs.length - 10} more songs`;
        }
    }
    
    embed.setDescription(description || 'Queue is empty');
    
    message.reply({ embeds: [embed] });
}

async function handleNowPlayingCommand(message) {
    const queue = getQueue(message.guild.id);
    
    if (!queue.nowPlaying) {
        return message.reply('❌ Nothing is currently playing!');
    }
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎵 Now Playing')
        .setDescription(`**${queue.nowPlaying.title}**`)
        .setThumbnail(queue.nowPlaying.thumbnail)
        .addFields(
            { name: 'Source', value: queue.nowPlaying.source?.toUpperCase() || 'YOUTUBE', inline: true },
            { name: 'Requested by', value: queue.nowPlaying.requestedBy.username, inline: true },
            { name: 'Volume', value: `${Math.round(queue.volume * 100)}%`, inline: true }
        );
    
    message.reply({ embeds: [embed], components: [createControlButtons(), createVolumeButtons()] });
}

async function handleLoopCommand(message) {
    const queue = getQueue(message.guild.id);
    queue.loop = !queue.loop;
    message.reply(`🔁 Loop ${queue.loop ? 'enabled' : 'disabled'}!`);
}

async function handleShuffleCommand(message) {
    const queue = getQueue(message.guild.id);
    
    if (queue.songs.length < 2) {
        return message.reply('❌ Not enough songs in queue to shuffle!');
    }
    
    queue.shuffle();
    message.reply('🔀 Queue shuffled!');
}

async function handleAutoplayCommand(message) {
    const queue = getQueue(message.guild.id);
    queue.autoplay = !queue.autoplay;
    message.reply(`🎵 Autoplay ${queue.autoplay ? 'enabled' : 'disabled'}!`);
}

async function handleJoinCommand(message, voiceChannel) {
    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        
        message.reply(`🎵 Joined ${voiceChannel.name}!`);
    } catch (error) {
        message.reply('❌ Failed to join voice channel!');
    }
}

async function handleLeaveCommand(message) {
    const queue = getQueue(message.guild.id);
    const player = audioPlayers.get(message.guild.id);
    
    if (player) {
        player.stop();
    }
    
    queue.clear();
    message.reply('👋 Left voice channel!');
}

// Button interaction handler
async function handleButtonInteraction(interaction) {
    const guildId = interaction.guild.id;
    const queue = getQueue(guildId);
    const player = audioPlayers.get(guildId);
    
    switch (interaction.customId) {
        case 'music_pause':
            if (player && queue.nowPlaying) {
                player.pause();
                interaction.reply({ content: '⏸️ Paused!', ephemeral: true });
            } else {
                interaction.reply({ content: '❌ Nothing is playing!', ephemeral: true });
            }
            break;
            
        case 'music_skip':
            if (player && queue.nowPlaying) {
                player.stop();
                interaction.reply({ content: '⏭️ Skipped!', ephemeral: true });
            } else {
                interaction.reply({ content: '❌ Nothing is playing!', ephemeral: true });
            }
            break;
            
        case 'music_stop':
            if (player) {
                player.stop();
                queue.clear();
                interaction.reply({ content: '⏹️ Stopped and cleared queue!', ephemeral: true });
            } else {
                interaction.reply({ content: '❌ Nothing is playing!', ephemeral: true });
            }
            break;
            
        case 'music_shuffle':
            if (queue.songs.length > 1) {
                queue.shuffle();
                interaction.reply({ content: '🔀 Queue shuffled!', ephemeral: true });
            } else {
                interaction.reply({ content: '❌ Not enough songs in queue!', ephemeral: true });
            }
            break;
            
        case 'music_loop':
            queue.loop = !queue.loop;
            interaction.reply({ content: `🔁 Loop ${queue.loop ? 'enabled' : 'disabled'}!`, ephemeral: true });
            break;
            
        case 'music_autoplay':
            queue.autoplay = !queue.autoplay;
            interaction.reply({ content: `🎵 Autoplay ${queue.autoplay ? 'enabled' : 'disabled'}!`, ephemeral: true });
            break;
            
        case 'volume_up':
            if (queue.volume < 1.0) {
                queue.volume = Math.min(1.0, queue.volume + 0.1);
                interaction.reply({ content: `🔊 Volume: ${Math.round(queue.volume * 100)}%`, ephemeral: true });
            } else {
                interaction.reply({ content: '❌ Volume already at maximum!', ephemeral: true });
            }
            break;
            
        case 'volume_down':
            if (queue.volume > 0.1) {
                queue.volume = Math.max(0.1, queue.volume - 0.1);
                interaction.reply({ content: `🔉 Volume: ${Math.round(queue.volume * 100)}%`, ephemeral: true });
            } else {
                interaction.reply({ content: '❌ Volume already at minimum!', ephemeral: true });
            }
            break;
            
        case 'music_queue':
            const queueEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📋 Current Queue');
            
            let description = '';
            
            if (queue.nowPlaying) {
                description += `**Now Playing:**\n🎵 ${queue.nowPlaying.title}\n\n`;
            }
            
            if (queue.songs.length > 0) {
                description += '**Up Next:**\n';
                queue.songs.slice(0, 5).forEach((song, index) => {
                    description += `${index + 1}. ${song.title}\n`;
                });
                
                if (queue.songs.length > 5) {
                    description += `\n... and ${queue.songs.length - 5} more songs`;
                }
            }
            
            queueEmbed.setDescription(description || 'Queue is empty');
            interaction.reply({ embeds: [queueEmbed], ephemeral: true });
            break;
    }
}

// Export functions for use in commands
global.getQueue = getQueue;
global.createGuildAudioPlayer = createGuildAudioPlayer;
global.playNext = playNext;
global.getTrackFromUrl = getTrackFromUrl;
global.createControlButtons = createControlButtons;
global.createVolumeButtons = createVolumeButtons;
global.getAutoplayTrack = getAutoplayTrack;

// Bot events
client.once('ready', async () => {
    console.log(`🎵 ${client.user.tag} music bot is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    
    // Register slash commands
    const commands = [];
    for (const [name, command] of client.commands) {
        commands.push(command.data.toJSON());
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('🔄 Refreshing application commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('✅ Application commands registered successfully!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
});

// Prefix command handling
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    
    if (!message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    
    // Check for command shortcuts
    const actualCommand = COMMAND_SHORTCUTS[commandName] || commandName;
    
    try {
        await handlePrefixCommand(message, actualCommand, args);
    } catch (error) {
        console.error('Prefix command error:', error);
        message.reply(`❌ Error: ${error.message}`);
    }
});

client.on('interactionCreate', async interaction => {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error('Command execution error:', error);
            const reply = { content: 'There was an error executing this command!', flags: 64 };
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    }
    
    // Handle button interactions
    if (interaction.isButton()) {
        try {
            await handleButtonInteraction(interaction);
        } catch (error) {
            console.error('Button interaction error:', error);
            interaction.reply({ content: '❌ Error handling button interaction!', ephemeral: true });
        }
    }
    
    // Handle dropdown selections from search command
    if (interaction.isStringSelectMenu() && interaction.customId === 'song_select') {
        await interaction.deferReply();
        
        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;
        const videoUrl = interaction.values[0];

        if (!voiceChannel) {
            return interaction.editReply('❌ आपको पहले किसी voice channel में join करना होगा!');
        }

        try {
            // Get video info using play-dl (more reliable than ytdl)
            let title, duration, thumbnail;
            
            try {
                const videoInfo = await play.video_info(videoUrl);
                title = videoInfo.video_details.title;
                duration = videoInfo.video_details.durationInSec;
                thumbnail = videoInfo.video_details.thumbnails[0]?.url;
            } catch (playDlError) {
                console.log('play-dl info failed, trying youtube-sr...');
                // Fallback to YouTube search to get basic info
                const videoId = videoUrl.split('v=')[1]?.split('&')[0];
                if (videoId) {
                    const searchResult = await YouTube.getVideo(videoUrl);
                    title = searchResult.title;
                    duration = searchResult.duration;
                    thumbnail = searchResult.thumbnail?.url;
                } else {
                    throw new Error('Unable to extract video info');
                }
            }

            const song = {
                title,
                url: videoUrl,
                duration,
                thumbnail,
                requestedBy: interaction.user,
            };

            // Join voice channel if not already connected
            let connection;
            try {
                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                });
            } catch (error) {
                console.log('Already connected or connection exists');
            }

            const queue = getQueue(interaction.guild.id);
            const player = createGuildAudioPlayer(interaction.guild.id);
            
            if (connection) {
                connection.subscribe(player);
            }

            if (queue.nowPlaying) {
                // Add to queue
                queue.add(song);
                return interaction.editReply(`📋 **${title}** को queue में add कर दिया! Position: ${queue.songs.length}`);
            } else {
                // Play immediately
                queue.add(song);
                playNext(interaction.guild.id);
                return interaction.editReply(`🎵 अब play हो रहा है: **${title}**`);
            }

        } catch (error) {
            console.error('Search selection error:', error);
            return interaction.editReply('❌ गाना play करने में error हुई!');
        }
    }
});

// Voice connection cleanup
client.on('voiceStateUpdate', (oldState, newState) => {
    const botId = client.user.id;
    
    // Check if the bot was disconnected from voice
    if (oldState.id === botId && oldState.channelId && !newState.channelId) {
        const guildId = oldState.guild.id;
        const queue = getQueue(guildId);
        const player = audioPlayers.get(guildId);
        
        if (player) {
            player.stop();
        }
        queue.clear();
        console.log(`[${guildId}] Bot disconnected, cleared queue`);
    }
});

// Error handling
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN environment variable is required!');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);