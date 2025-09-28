const { EmbedBuilder } = require('discord.js');
const { getQueue } = require('../utils/QueueManager');
const { getCachedGuildSettings, getCachedSearchResults } = require('../utils/CacheManager');
const { toUnifiedTrack, createNowPlayingEmbed, formatDuration } = require('../utils/TrackHelpers');
const { createFallbackPlayer, playFallbackTrack, handleFallbackTrackEnd, cleanupFallbackPlayer, lavalinkManager, lavalinkAvailable } = require('./MusicPlayer');
const { updateGuildPrefix, logCommand } = require('./database');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
const config = require('../config/botConfig');

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
        if (lavalinkAvailable && lavalinkManager) {
            const result = await lavalinkManager.search({
                query,
                source: config.SOURCES.DEFAULT
            }, message.author);

            if (!result.tracks.length) {
                return await handleFallbackSearch(message, query, loadingMsg, guildSettings, messages);
            }

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
            await handleFallbackSearch(message, query, loadingMsg, guildSettings, messages);
        }

    } catch (error) {
        console.error('Play command error:', error);
        await handleFallbackSearch(message, query, loadingMsg, guildSettings, messages);
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
    
    if (lavalinkAvailable && lavalinkManager) {
        const player = lavalinkManager.getPlayer(message.guild.id);
        if (player) {
            await player.skip();
        }
    } else {
        const player = global.audioPlayers.get(message.guild.id);
        if (player) {
            player.stop();
        }
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

    if (lavalinkAvailable && lavalinkManager) {
        const player = lavalinkManager.getPlayer(message.guild.id);
        if (player) {
            await player.destroy();
        }
    } else {
        cleanupFallbackPlayer(message.guild.id);
    }

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
            { name: '🔧 Mode', value: lavalinkAvailable ? 'Lavalink' : 'Enhanced Fallback', inline: true }
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

module.exports = {
    handlePlayCommand,
    handleSkipCommand,
    handleStopCommand,
    handleQueueCommand,
    handleStatusCommand,
    handleHelpCommand,
    handleFallbackSearch
};