const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const ytdl = require('ytdl-core');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('YouTube URL से गाना play करें')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('YouTube video का URL')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        const url = interaction.options.getString('url');

        if (!voiceChannel) {
            return interaction.editReply('❌ आपको पहले किसी voice channel में join करना होगा!');
        }

        if (!ytdl.validateURL(url)) {
            return interaction.editReply('❌ Invalid YouTube URL! सही YouTube link दें।');
        }

        try {
            // Get video info
            const info = await ytdl.getInfo(url);
            const title = info.videoDetails.title;
            const duration = parseInt(info.videoDetails.lengthSeconds);
            const thumbnail = info.videoDetails.thumbnails[0]?.url;

            const song = {
                title,
                url,
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

            const queue = global.getQueue(interaction.guild.id);
            const player = global.createGuildAudioPlayer(interaction.guild.id);
            
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
                global.playNext(interaction.guild.id);
                return interaction.editReply(`🎵 अब play हो रहा है: **${title}**`);
            }

        } catch (error) {
            console.error('Play command error:', error);
            return interaction.editReply('❌ गाना play करने में error हुई! URL check करें।');
        }
    },
};