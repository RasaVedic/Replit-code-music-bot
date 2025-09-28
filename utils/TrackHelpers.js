const config = require('../config/botConfig');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

module.exports = {
    toUnifiedTrack,
    createNowPlayingEmbed,
    formatDuration
};