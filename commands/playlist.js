const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('YouTube playlist को queue में add करें')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('YouTube playlist का URL')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const member = interaction.member;
        if (!member) {
            return interaction.editReply('❌ Member information not available. Please try again.');
        }
        
        const voiceChannel = member.voice?.channel;
        const playlistUrl = interaction.options.getString('url');

        if (!voiceChannel) {
            return interaction.editReply('❌ आपको पहले किसी voice channel में join करना होगा!');
        }

        try {
            // Check if it's a playlist URL
            if (!playlistUrl.includes('playlist?list=')) {
                return interaction.editReply('❌ यह एक valid YouTube playlist URL नहीं है!');
            }

            // Get playlist videos
            const playlist = await YouTube.getPlaylist(playlistUrl);
            if (!playlist || !playlist.videos || playlist.videos.length === 0) {
                return interaction.editReply('❌ Playlist empty है या load नहीं हो सकी!');
            }

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

            const queue = global.getQueue(interaction.guild.id);
            const player = global.createGuildAudioPlayer(interaction.guild.id);
            
            if (connection) {
                connection.subscribe(player);
            }

            let addedCount = 0;
            const maxSongs = 50; // Limit to prevent abuse

            // Add songs to queue
            for (const video of playlist.videos.slice(0, maxSongs)) {
                try {
                    const song = {
                        title: video.title,
                        url: video.url,
                        duration: video.durationInSec || 0,
                        thumbnail: video.thumbnail?.url,
                        requestedBy: interaction.user,
                    };

                    queue.add(song);
                    addedCount++;
                } catch (error) {
                    console.error(`Error adding song: ${video.title}`, error);
                }
            }

            if (addedCount === 0) {
                return interaction.editReply('❌ Playlist से कोई गाना add नहीं हो सका!');
            }

            // Start playing if nothing is currently playing
            if (!queue.nowPlaying) {
                global.playNext(interaction.guild.id);
            }

            return interaction.editReply(
                `📋 **${playlist.title}** playlist से ${addedCount} songs को queue में add कर दिया!\n` +
                `🎵 Total queue: ${queue.songs.length} songs`
            );

        } catch (error) {
            console.error('Playlist command error:', error);
            return interaction.editReply('❌ Playlist load करने में error हुई! URL check करें।');
        }
    },
};