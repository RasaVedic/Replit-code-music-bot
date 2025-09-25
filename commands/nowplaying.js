const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Currently playing गाना की जानकारी दिखाएं'),

    async execute(interaction) {
        const queue = global.getQueue(interaction.guild.id);
        
        if (!queue.nowPlaying) {
            return interaction.reply({ 
                content: '❌ कोई गाना play नहीं हो रहा है!', 
                ephemeral: true 
            });
        }

        const song = queue.nowPlaying;
        const formatDuration = (seconds) => {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        const embed = new EmbedBuilder()
            .setTitle('🎵 Now Playing')
            .setDescription(`**${song.title}**`)
            .addFields(
                { 
                    name: '⏱️ Duration', 
                    value: formatDuration(song.duration), 
                    inline: true 
                },
                { 
                    name: '🔊 Volume', 
                    value: `${Math.round(queue.volume * 100)}%`, 
                    inline: true 
                },
                { 
                    name: '📋 Queue Length', 
                    value: `${queue.songs.length} songs`, 
                    inline: true 
                },
                { 
                    name: '👤 Requested by', 
                    value: song.requestedBy.toString(), 
                    inline: false 
                }
            )
            .setColor('#00ff00')
            .setTimestamp();

        if (song.thumbnail) {
            embed.setThumbnail(song.thumbnail);
        }

        await interaction.reply({ embeds: [embed] });
    },
};