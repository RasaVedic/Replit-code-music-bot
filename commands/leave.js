const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Bot को voice channel से disconnect करें'),

    async execute(interaction) {
        const connection = getVoiceConnection(interaction.guild.id);
        
        if (!connection) {
            return interaction.reply({ 
                content: '❌ मैं किसी voice channel में नहीं हूं!', 
                ephemeral: true 
            });
        }

        // Stop music and clear queue
        const queue = global.getQueue(interaction.guild.id);
        const player = global.createGuildAudioPlayer(interaction.guild.id);
        
        player.stop();
        queue.clear();
        connection.destroy();

        await interaction.reply('👋 Voice channel से disconnect हो गया!');
    },
};