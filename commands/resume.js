const { SlashCommandBuilder } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Paused गाना resume करें'),

    async execute(interaction) {
        const queue = global.getQueue(interaction.guild.id);
        
        if (!queue.nowPlaying) {
            return interaction.reply({ 
                content: '❌ कोई गाना play नहीं हो रहा है!', 
                ephemeral: true 
            });
        }

        const player = global.createGuildAudioPlayer(interaction.guild.id);
        
        if (player.state.status === AudioPlayerStatus.Paused) {
            player.unpause();
            await interaction.reply('▶️ Music को resume कर दिया!');
        } else {
            await interaction.reply({ 
                content: '❌ Music pause में नहीं है!', 
                ephemeral: true 
            });
        }
    },
};