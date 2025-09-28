const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
const play = require('play-dl');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
    ],
});

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
        this.volume = 0.5;
        this.loop = false;
    }

    add(song) {
        this.songs.push(song);
    }

    next() {
        if (this.loop && this.nowPlaying) {
            return this.nowPlaying;
        }
        return this.songs.shift();
    }

    clear() {
        this.songs = [];
        this.nowPlaying = null;
    }

    isEmpty() {
        return this.songs.length === 0;
    }
}

function getQueue(guildId) {
    if (!musicQueues.has(guildId)) {
        musicQueues.set(guildId, new MusicQueue(guildId));
    }
    return musicQueues.get(guildId);
}

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

    const nextSong = queue.next();
    if (!nextSong) {
        queue.nowPlaying = null;
        return;
    }

    queue.nowPlaying = nextSong;
    console.log(`[${guildId}] Playing: ${nextSong.title}`);

    // Try multiple methods to get the audio stream
    let stream = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (!stream && retryCount < maxRetries) {
        try {
            if (retryCount === 0) {
                // Try play-dl first (more reliable)
                console.log(`[${guildId}] Trying play-dl...`);
                
                // Refresh tokens if needed
                if (await play.is_expired()) {
                    await play.refreshToken();
                }
                
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

// Export functions for use in commands
global.getQueue = getQueue;
global.createGuildAudioPlayer = createGuildAudioPlayer;
global.playNext = playNext;

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