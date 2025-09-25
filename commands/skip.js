const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Current गाना skip करें'),

    async execute(interaction) {
        const queue = global.getQueue(interaction.guild.id);
        
        if (!queue.nowPlaying) {
            return interaction.reply({ 
                content: '❌ कोई गाना play नहीं हो रहा है!', 
                ephemeral: true 
            });
        }

        const skippedSong = queue.nowPlaying.title;
        
        // Stop current song to trigger next
        const player = global.createGuildAudioPlayer(interaction.guild.id);
        player.stop();

        await interaction.reply(`⏭️ **${skippedSong}** को skip कर दिया!`);
    },
};