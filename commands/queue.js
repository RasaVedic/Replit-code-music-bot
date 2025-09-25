const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Current music queue दिखाएं'),

    async execute(interaction) {
        const queue = global.getQueue(interaction.guild.id);

        if (!queue.nowPlaying && queue.isEmpty()) {
            return interaction.reply({ 
                content: '❌ Queue empty है!', 
                ephemeral: true 
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🎵 Music Queue')
            .setColor('#00ff00')
            .setTimestamp();

        let description = '';

        if (queue.nowPlaying) {
            description += `**🎵 अभी play हो रहा है:**\n${queue.nowPlaying.title}\n\n`;
        }

        if (!queue.isEmpty()) {
            description += '**📋 Next songs:**\n';
            queue.songs.slice(0, 10).forEach((song, index) => {
                description += `${index + 1}. ${song.title}\n`;
            });

            if (queue.songs.length > 10) {
                description += `\n...और ${queue.songs.length - 10} songs`;
            }
        }

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed] });
    },
};