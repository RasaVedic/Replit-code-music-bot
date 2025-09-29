const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const play = require('play-dl'); // Using play-dl instead of direct ytdl-core
const YouTube = require('youtube-sr').default;

if (!process.env.YT_API_KEY) {
    console.warn('⚠️ YT_API_KEY ENV variable not set! Rate limits may occur.');
} else {
    play.setToken({
        youtube: { api_key: process.env.YT_API_KEY }
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('YouTube URL या गाने का नाम से play करें')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('YouTube URL या गाने का नाम')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const member = interaction.member;
        if (!member) return interaction.editReply('❌ Member information not available. Please try again.');

        const voiceChannel = member.voice?.channel;
        const query = interaction.options.getString('query');

        if (!voiceChannel) return interaction.editReply('❌ आपको पहले किसी voice channel में join करना होगा!');

        try {
            let videoUrl, title, duration, thumbnail;
            let searchResults;

            try {
                if (play.yt_validate(query) === 'video') {
                    // URL case
                    const info = await play.video_info(query);
                    videoUrl = info.url;
                    title = info.title;
                    duration = info.durationInSec;
                    thumbnail = info.thumbnails[0]?.url;
                } else {
                    // Search case
                    searchResults = await play.search(query, { limit: 1 });
                    if (!searchResults || searchResults.length === 0) {
                        return interaction.editReply('❌ कोई गाना नहीं मिला! दूसरा नाम try करें।');
                    }
                    const video = searchResults[0];
                    videoUrl = video.url;
                    title = video.title;
                    duration = video.durationInSec;
                    thumbnail = video.thumbnails[0]?.url;
                }
            } catch (err) {
                console.warn('⚠️ play-dl error:', err);
                // Fallback to youtube-sr
                searchResults = await YouTube.search(query, { limit: 1 });
                if (!searchResults || searchResults.length === 0) {
                    return interaction.editReply('❌ कोई गाना नहीं मिला! दूसरा नाम try करें।');
                }
                const video = searchResults[0];
                videoUrl = video.url;
                title = video.title;
                duration = video.durationInSec || 0;
                thumbnail = video.thumbnail?.url;
            }

            const song = {
                title,
                url: videoUrl,
                duration,
                thumbnail,
                requestedBy: interaction.user,
            };

            // Join voice channel
            let connection;
            try {
                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                });
            } catch (err) {
                console.log('Already connected or connection exists');
            }

            const queue = global.getQueue(interaction.guild.id);
            const player = global.createGuildAudioPlayer(interaction.guild.id);

            if (connection) connection.subscribe(player);

            if (queue.nowPlaying) {
                queue.add(song);
                return interaction.editReply(`📋 **${title}** को queue में add कर दिया! Position: ${queue.songs.length}`);
            } else {
                queue.add(song);
                global.playNext(interaction.guild.id);
                return interaction.editReply(`🎵 अब play हो रहा है: **${title}**`);
            }

        } catch (error) {
            console.error('Play command error:', error);
            return interaction.editReply('❌ गाना play करने में error हुई! दूसरा गाना try करें।');
        }
    },
};