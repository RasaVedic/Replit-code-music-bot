const { EmbedBuilder } = require('discord.js');
const { getQueue } = require('../utils/QueueManager');
const { getCachedGuildSettings, getCachedSearchResults } = require('../utils/CacheManager');
const { toUnifiedTrack, createNowPlayingEmbed, formatDuration } = require('../utils/TrackHelpers');
const { createFallbackPlayer, playFallbackTrack, handleFallbackTrackEnd, cleanupFallbackPlayer, lavalinkManager, lavalinkAvailable } = require('./MusicPlayer');
const { updateGuildPrefix, logCommand } = require('./database');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
const config = require('../config/botConfig');

// Helper function to check if user is in same voice channel as bot
function checkSameVoiceChannel(message) {
    const userChannel = message.member.voice.channel;
    if (!userChannel) {
        return { valid: false, error: '❌ आपको voice channel में होना चाहिए!' };
    }

    // Check voice connection
    const { getVoiceConnection } = require('@discordjs/voice');
    const connection = getVoiceConnection(message.guild.id);
    if (connection && connection.joinConfig && userChannel.id !== connection.joinConfig.channelId) {
        return { valid: false, error: '❌ आपको bot के साथ same voice channel में होना चाहिए!' };
    }

    return { valid: true };
}

// Play command handler with fallback
async function handlePlayCommand(message, args, guildSettings) {
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
    
    queue.textChannel = message.channel;
    queue.voiceChannel = message.member.voice.channel;

    const loadingEmbed = new EmbedBuilder()
        .setDescription(`${config.EMOJIS.LOADING} ${messages.LOADING}`)
        .setColor(config.COLORS.INFO);
    const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

    try {
        // Use enhanced streaming system for reliable playback
        await handleFallbackSearch(message, query, loadingMsg, guildSettings, messages);
    } catch (error) {
        console.error('Play command error:', error);
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.ERROR} Error`)
            .setDescription(messages.ERROR_OCCURRED)
            .setColor(config.COLORS.ERROR);
        await loadingMsg.edit({ embeds: [embed] });
    }
}

async function handleFallbackSearch(message, query, loadingMsg, guildSettings, messages) {
    try {
        let results;
        
        if (ytdl.validateURL(query)) {
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
            queue.add(track);

            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.SUCCESS} ${messages.SONG_ADDED}`)
                .setDescription(`**${track.title}**\nby ${track.author}`)
                .addFields(
                    { name: '⏱️ Duration', value: formatDuration((track.duration || 0) * 1000), inline: true },
                    { name: '📍 Position', value: `${queue.size()}`, inline: true },
                    { name: '🎵 Mode', value: 'Enhanced Streaming', inline: true }
                )
                .setThumbnail(track.thumbnail)
                .setColor(config.COLORS.SUCCESS);

            await loadingMsg.edit({ embeds: [embed] });
        } else {
            const unifiedTrack = toUnifiedTrack(track, 'fallback');
            queue.nowPlaying = unifiedTrack;
            const success = await playFallbackTrack(message.guild.id, track);
            
            if (success) {
                const guildSettings = getCachedGuildSettings(message.guild.id);
                const nowPlayingMessage = createNowPlayingEmbed(unifiedTrack, queue, guildSettings);
                
                try {
                    await loadingMsg.edit(nowPlayingMessage);
                } catch (error) {
                    console.log('Could not edit to now playing message:', error.message);
                    const fallbackEmbed = new EmbedBuilder()
                        .setTitle(`${config.EMOJIS.MUSIC} Now Playing (Enhanced Mode)`)
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

// Skip command handler
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
    
    // Use enhanced streaming system
    const player = global.audioPlayers.get(message.guild.id);
    if (player) {
        player.stop();
    }

    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.SKIP} ${messages.SONG_SKIPPED}`)
        .setDescription(`**${currentTrack.title || currentTrack.info?.title}**`)
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

// Stop command handler
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

    // Use enhanced streaming system
    cleanupFallbackPlayer(message.guild.id);

    queue.clear();
    global.queues.delete(message.guild.id);

    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.SUCCESS} ${messages.MUSIC_STOPPED}`)
        .setDescription('Music stopped and queue cleared!')
        .setColor(config.COLORS.SUCCESS);
    await message.reply({ embeds: [embed] });
}

// Queue command handler
async function handleQueueCommand(message, guildSettings) {
    const queue = getQueue(message.guild.id);
    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.QUEUE} Music Queue`)
        .setColor(config.COLORS.QUEUE);

    let description = '';

    if (queue.nowPlaying) {
        description += `**🎵 Now Playing:**\n${queue.nowPlaying.info?.title || queue.nowPlaying.title}\n\n`;
    }

    if (!queue.isEmpty()) {
        description += '**📋 Up Next:**\n';
        queue.songs.slice(0, 10).forEach((song, index) => {
            const title = song.info?.title || song.title;
            const author = song.info?.author || song.author;
            description += `${index + 1}. ${title} - ${author}\n`;
        });

        if (queue.size() > 10) {
            description += `\n...and ${queue.size() - 10} more songs`;
        }
        description += `\n**Total songs:** ${queue.size()}`;
    } else {
        description += '**Queue is empty**';
    }

    embed.setDescription(description);
    await message.reply({ embeds: [embed] });
}

// Status command handler
async function handleStatusCommand(message, guildSettings) {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const activeQueues = global.queues.size;
    const activePlayers = global.audioPlayers.size;
    
    const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Status')
        .setColor(config.COLORS.INFO)
        .addFields(
            { name: '🏓 Ping', value: `${message.client.ws.ping}ms`, inline: true },
            { name: '⏱️ Uptime', value: formatUptime(uptime), inline: true },
            { name: '🖥️ Memory', value: `${Math.round(memoryUsage.used / 1024 / 1024)}MB`, inline: true },
            { name: '🎵 Active Players', value: `${activePlayers}`, inline: true },
            { name: '📋 Active Queues', value: `${activeQueues}`, inline: true },
            { name: '🔧 Mode', value: 'Enhanced Streaming', inline: true }
        )
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

// Help command handler
async function handleHelpCommand(message, guildSettings) {
    const prefix = guildSettings.prefix;
    
    const embed = new EmbedBuilder()
        .setTitle('🎵 EchoTune Commands Help')
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
                      `\`${prefix}nowplaying\` \`${prefix}np\` - Current song\n` +
                      `\`${prefix}loop\` \`${prefix}l\` - Toggle loop\n` +
                      `\`${prefix}autoplay\` - Toggle autoplay`,
                inline: true
            },
            {
                name: '⚙️ Settings & Info',
                value: `\`${prefix}status\` - Bot performance stats\n` +
                      `\`${prefix}help\` - This help message\n` +
                      `\`${prefix}join\` - Join voice channel\n` +
                      `\`${prefix}leave\` - Leave voice channel`,
                inline: true
            }
        )
        .setFooter({ text: 'Use buttons on now playing messages for quick controls!' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

// Helper function to format uptime
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

// Pause command handler
async function handlePauseCommand(message, guildSettings) {
    const { AudioPlayerStatus } = require('@discordjs/voice');
    const queue = getQueue(message.guild.id);
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription('❌ कोई गाना play नहीं हो रहा है!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    try {
        // Use enhanced streaming system
        const player = global.audioPlayers.get(message.guild.id);
        if (!player) {
            const embed = new EmbedBuilder()
                .setDescription('❌ Audio player नहीं मिला!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }
        
        if (player.state.status === AudioPlayerStatus.Playing) {
            player.pause();
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.PAUSE} Music Paused`)
                .setDescription('⏸️ Music को pause कर दिया!')
                .setColor(config.COLORS.SUCCESS);
            await message.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setDescription('❌ Music पहले से pause है!')
                .setColor(config.COLORS.WARNING);
            await message.reply({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Pause command error:', error);
        const embed = new EmbedBuilder()
            .setDescription('❌ Pause करने में error हुई!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Resume command handler
async function handleResumeCommand(message, guildSettings) {
    const { AudioPlayerStatus } = require('@discordjs/voice');
    const queue = getQueue(message.guild.id);
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription('❌ कोई गाना play नहीं हो रहा है!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    try {
        // Use enhanced streaming system
        const player = global.audioPlayers.get(message.guild.id);
        if (!player) {
            const embed = new EmbedBuilder()
                .setDescription('❌ Audio player नहीं मिला!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }
        
        if (player.state.status === AudioPlayerStatus.Paused) {
            player.unpause();
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.PLAY} Music Resumed`)
                .setDescription('▶️ Music को resume कर दिया!')
                .setColor(config.COLORS.SUCCESS);
            await message.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setDescription('❌ Music pause में नहीं है!')
                .setColor(config.COLORS.WARNING);
            await message.reply({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Resume command error:', error);
        const embed = new EmbedBuilder()
            .setDescription('❌ Resume करने में error हुई!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Volume command handler
async function handleVolumeCommand(message, args, guildSettings) {
    const queue = getQueue(message.guild.id);
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (!queue.nowPlaying) {
        const embed = new EmbedBuilder()
            .setDescription('❌ कोई गाना play नहीं हो रहा है!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    // Get current volume (default to 50 if not set)
    const currentVolume = queue.volume || 50;
    
    if (!args.length) {
        const embed = new EmbedBuilder()
            .setTitle('🔊 Current Volume')
            .setDescription(`Current volume: **${Math.round(currentVolume)}%**\nUsage: \`${guildSettings.prefix}volume <0-100>\``)
            .setColor(config.COLORS.INFO);
        return await message.reply({ embeds: [embed] });
    }

    const volume = parseInt(args[0]);
    if (isNaN(volume) || volume < 0 || volume > 100) {
        const embed = new EmbedBuilder()
            .setDescription('❌ Volume 0-100 के बीच होना चाहिए!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    try {
        // Store volume in queue
        queue.volume = volume;
        
        // Try Lavalink first
        if (lavalinkAvailable && lavalinkManager) {
            const player = lavalinkManager.getPlayer(message.guild.id);
            if (player) {
                await player.setVolume(volume);
                const embed = new EmbedBuilder()
                    .setTitle(`${config.EMOJIS.VOLUME} Volume Updated`)
                    .setDescription(`🔊 Volume को ${volume}% set कर दिया!`)
                    .setColor(config.COLORS.SUCCESS);
                return await message.reply({ embeds: [embed] });
            }
        }

        // Fallback to @discordjs/voice
        const player = global.audioPlayers.get(message.guild.id);
        if (player && player.state.resource) {
            const volumeDecimal = volume / 100;
            player.state.resource.volume?.setVolume(volumeDecimal);
        }

        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.VOLUME} Volume Updated`)
            .setDescription(`🔊 Volume को ${volume}% set कर दिया!`)
            .setColor(config.COLORS.SUCCESS);
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Volume command error:', error);
        const embed = new EmbedBuilder()
            .setDescription('❌ Volume set करने में error हुई!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Join command handler
async function handleJoinCommand(message, guildSettings) {
    const { joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
    
    if (!message.member.voice.channel) {
        const embed = new EmbedBuilder()
            .setDescription('❌ आपको पहले किसी voice channel में join करना होगा!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    const voiceChannel = message.member.voice.channel;
    const permissions = voiceChannel.permissionsFor(message.client.user);
    
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        const embed = new EmbedBuilder()
            .setDescription('❌ मुझे voice channel में जाने की permission नहीं है!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    try {
        // Try Lavalink first
        if (lavalinkAvailable && lavalinkManager) {
            let player = lavalinkManager.getPlayer(message.guild.id);
            if (!player) {
                player = lavalinkManager.createPlayer({
                    guildId: message.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: message.channel.id,
                    selfDeaf: true,
                    volume: guildSettings.volume || 50
                });
            }
            await player.connect();
            
            const embed = new EmbedBuilder()
                .setTitle(`${config.EMOJIS.SUCCESS} Joined Voice Channel`)
                .setDescription(`🎵 **${voiceChannel.name}** में join हो गया! (Lavalink Mode)`)
                .setColor(config.COLORS.SUCCESS);
            return await message.reply({ embeds: [embed] });
        }

        // Fallback to @discordjs/voice
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        // Subscribe the audio player to the voice connection
        const player = global.createGuildAudioPlayer(message.guild.id);
        connection.subscribe(player);
        
        global.connections.set(message.guild.id, connection);

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`[${message.guild.id}] Voice connection ready`);
        });

        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SUCCESS} Joined Voice Channel`)
            .setDescription(`🎵 **${voiceChannel.name}** में join हो गया! (Fallback Mode)`)
            .setColor(config.COLORS.SUCCESS);
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Voice connection error:', error);
        const embed = new EmbedBuilder()
            .setDescription('❌ Voice channel join करने में error हुई!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Leave command handler
async function handleLeaveCommand(message, guildSettings) {
    const { getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
    const guildId = message.guild.id;
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    try {
        let disconnected = false;
        
        // Try Lavalink first
        if (lavalinkAvailable && lavalinkManager) {
            const player = lavalinkManager.getPlayer(guildId);
            if (player) {
                await player.destroy();
                disconnected = true;
                console.log(`🚪 Lavalink player destroyed in guild ${guildId}`);
            }
        }
        
        // Handle @discordjs/voice connections
        const connection = getVoiceConnection(guildId);
        const fallbackPlayer = global.audioPlayers?.get(guildId);
        
        if (fallbackPlayer) {
            fallbackPlayer.stop();
            global.audioPlayers.delete(guildId);
            disconnected = true;
        }
        
        if (connection) {
            try {
                if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                }
                global.connections?.delete(guildId);
                disconnected = true;
            } catch (error) {
                console.log(`Leave command cleanup warning: ${error.message}`);
                global.connections?.delete(guildId);
            }
        }
        
        // Clear queue
        const queue = global.queues?.get(guildId);
        if (queue) {
            queue.clear();
            global.queues.delete(guildId);
        }
        
        if (!disconnected) {
            const embed = new EmbedBuilder()
                .setDescription('❌ मैं किसी voice channel में नहीं हूं!')
                .setColor(config.COLORS.ERROR);
            return await message.reply({ embeds: [embed] });
        }

        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SUCCESS} Successfully Disconnected`)
            .setDescription('👋 Voice channel से disconnect हो गया!')
            .setColor(config.COLORS.SUCCESS)
            .setFooter({ text: 'Queue cleared and music stopped' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        console.log(`🚪 Bot left voice channel in guild ${guildId}`);

    } catch (error) {
        console.error('Leave command error:', error);
        const embed = new EmbedBuilder()
            .setDescription('⚠️ Disconnect करने में problem हुई, लेकिन bot को manually cleanup कर दिया!')
            .setColor(config.COLORS.WARNING);
        await message.reply({ embeds: [embed] });
    }
}

// Loop command handler
async function handleLoopCommand(message, args, guildSettings) {
    const queue = getQueue(message.guild.id);
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (!queue.nowPlaying && queue.isEmpty()) {
        const embed = new EmbedBuilder()
            .setDescription('❌ कोई गाना play नहीं हो रहा है!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    // Toggle loop if no argument provided
    if (!args.length) {
        queue.loop = !queue.loop;
    } else {
        const mode = args[0].toLowerCase();
        if (mode === 'on' || mode === 'song' || mode === 'true') {
            queue.loop = true;
        } else if (mode === 'off' || mode === 'false') {
            queue.loop = false;
        } else {
            queue.loop = !queue.loop;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(`${config.EMOJIS.LOOP} Loop Mode ${queue.loop ? 'Enabled' : 'Disabled'}`)
        .setDescription(queue.loop ? 
            '🔂 Current song को loop mode पर set कर दिया!' : 
            '➡️ Loop mode off कर दिया!')
        .setColor(queue.loop ? config.COLORS.SUCCESS : config.COLORS.WARNING);
    
    await message.reply({ embeds: [embed] });
}

// Shuffle command handler
async function handleShuffleCommand(message, guildSettings) {
    const queue = getQueue(message.guild.id);
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (queue.isEmpty()) {
        const embed = new EmbedBuilder()
            .setDescription('❌ Queue में कोई गाना नहीं है!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    if (queue.size() < 2) {
        const embed = new EmbedBuilder()
            .setDescription('❌ Shuffle करने के लिए कम से कम 2 गाने होने चाहिए!')
            .setColor(config.COLORS.WARNING);
        return await message.reply({ embeds: [embed] });
    }

    try {
        queue.shuffle();
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SHUFFLE} Queue Shuffled`)
            .setDescription(`🔀 ${queue.size()} गाने shuffle कर दिए गए!`)
            .setColor(config.COLORS.SUCCESS);
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Shuffle command error:', error);
        const embed = new EmbedBuilder()
            .setDescription('❌ Shuffle करने में error हुई!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Clear command handler
async function handleClearCommand(message, guildSettings) {
    const queue = getQueue(message.guild.id);
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (queue.isEmpty()) {
        const embed = new EmbedBuilder()
            .setDescription('❌ Queue पहले से ही empty है!')
            .setColor(config.COLORS.WARNING);
        return await message.reply({ embeds: [embed] });
    }

    try {
        const queueSize = queue.size();
        queue.clear();
        
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SUCCESS} Queue Cleared`)
            .setDescription(`🗑️ ${queueSize} गाने queue से clear कर दिए गए!`)
            .setColor(config.COLORS.SUCCESS)
            .setFooter({ text: 'Current playing song continues' });
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Clear command error:', error);
        const embed = new EmbedBuilder()
            .setDescription('❌ Queue clear करने में error हुई!')
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Remove command handler
async function handleRemoveCommand(message, args, guildSettings) {
    const queue = getQueue(message.guild.id);
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (queue.isEmpty()) {
        const embed = new EmbedBuilder()
            .setDescription('❌ Queue में कोई गाना नहीं है!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    if (!args.length) {
        const embed = new EmbedBuilder()
            .setDescription(`❌ Position specify करें!\nUsage: \`${guildSettings.prefix}remove <position>\`\nExample: \`${guildSettings.prefix}remove 3\``)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    const position = parseInt(args[0]);
    if (isNaN(position) || position < 1) {
        const embed = new EmbedBuilder()
            .setDescription('❌ Valid position number डालें! (1, 2, 3...)')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    try {
        const removedSong = queue.remove(position);
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SUCCESS} Song Removed`)
            .setDescription(`🗑️ **${removedSong.title}** को queue से remove कर दिया!`)
            .setColor(config.COLORS.SUCCESS)
            .setFooter({ text: `Position: ${position}` });
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Remove command error:', error.message);
        const embed = new EmbedBuilder()
            .setDescription(`❌ ${error.message}`)
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

// Move command handler
async function handleMoveCommand(message, args, guildSettings) {
    const queue = getQueue(message.guild.id);
    
    // Voice channel validation
    const channelCheck = checkSameVoiceChannel(message);
    if (!channelCheck.valid) {
        const embed = new EmbedBuilder()
            .setDescription(channelCheck.error)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }
    
    if (queue.isEmpty()) {
        const embed = new EmbedBuilder()
            .setDescription('❌ Queue में कोई गाना नहीं है!')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    if (args.length < 2) {
        const embed = new EmbedBuilder()
            .setDescription(`❌ From और to position specify करें!\nUsage: \`${guildSettings.prefix}move <from> <to>\`\nExample: \`${guildSettings.prefix}move 3 1\``)
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    const fromPosition = parseInt(args[0]);
    const toPosition = parseInt(args[1]);
    
    if (isNaN(fromPosition) || isNaN(toPosition) || fromPosition < 1 || toPosition < 1) {
        const embed = new EmbedBuilder()
            .setDescription('❌ Valid position numbers डालें! (1, 2, 3...)')
            .setColor(config.COLORS.ERROR);
        return await message.reply({ embeds: [embed] });
    }

    try {
        const movedSong = queue.move(fromPosition, toPosition);
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SUCCESS} Song Moved`)
            .setDescription(`🔄 **${movedSong.title}** को position ${fromPosition} से ${toPosition} पर move कर दिया!`)
            .setColor(config.COLORS.SUCCESS);
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Move command error:', error.message);
        const embed = new EmbedBuilder()
            .setDescription(`❌ ${error.message}`)
            .setColor(config.COLORS.ERROR);
        await message.reply({ embeds: [embed] });
    }
}

module.exports = {
    handlePlayCommand,
    handleSkipCommand,
    handleStopCommand,
    handleQueueCommand,
    handleStatusCommand,
    handleHelpCommand,
    handlePauseCommand,
    handleResumeCommand,
    handleVolumeCommand,
    handleJoinCommand,
    handleLeaveCommand,
    handleLoopCommand,
    handleShuffleCommand,
    handleClearCommand,
    handleRemoveCommand,
    handleMoveCommand,
    handleFallbackSearch
};