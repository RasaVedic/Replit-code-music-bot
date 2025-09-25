const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Music को stop करें और queue clear करें'),

    async execute(interaction) {
        const queue = global.getQueue(interaction.guild.id);
        
        if (!queue.nowPlaying && queue.isEmpty()) {
            return interaction.reply({ 
                content: '❌ कोई गाना play नहीं हो रहा है!', 
                ephemeral: true 
            });
        }

        // Stop player and clear queue
        const player = global.createGuildAudioPlayer(interaction.guild.id);
        player.stop();
        queue.clear();

        await interaction.reply('⏹️ Music stop कर दिया और queue clear कर दिया!');
    },
};