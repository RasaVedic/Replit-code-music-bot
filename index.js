const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
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

    try {
        queue.nowPlaying = nextSong;
        console.log(`[${guildId}] Playing: ${nextSong.title}`);

        const stream = ytdl(nextSong.url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25,
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }
        });

        const resource = createAudioResource(stream, {
            metadata: nextSong,
            inputType: 'webm/opus',
            inlineVolume: true
        });

        // Set initial volume
        if (resource.volume) {
            resource.volume.setVolume(queue.volume);
        }

        player.play(resource);
    } catch (error) {
        console.error(`[${guildId}] Error playing song:`, error);
        queue.nowPlaying = null;
        playNext(guildId);
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
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error('Command execution error:', error);
        const reply = { content: 'There was an error executing this command!', ephemeral: true };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
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