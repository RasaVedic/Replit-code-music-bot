const { SlashCommandBuilder } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Current गाना pause करें'),

    async execute(interaction) {
        const queue = global.getQueue(interaction.guild.id);
        
        if (!queue.nowPlaying) {
            return interaction.reply({ 
                content: '❌ कोई गाना play नहीं हो रहा है!', 
                ephemeral: true 
            });
        }

        const player = global.createGuildAudioPlayer(interaction.guild.id);
        
        if (player.state.status === AudioPlayerStatus.Playing) {
            player.pause();
            await interaction.reply('⏸️ Music को pause कर दिया!');
        } else {
            await interaction.reply({ 
                content: '❌ Music पहले से pause है!', 
                ephemeral: true 
            });
        }
    },
};