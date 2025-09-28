const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Bot को voice channel से disconnect करें'),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        
        // Check if bot is in a voice channel
        const connection = getVoiceConnection(guildId);
        const player = global.audioPlayers?.get(guildId);
        const queue = global.queues?.get(guildId);
        
        if (!connection && !player) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Not Connected')
                .setDescription('मैं किसी voice channel में नहीं हूं!')
                .setColor('#ff0000');
            
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        try {
            // Stop music and clear queue with proper error handling
            if (player) {
                player.stop();
                global.audioPlayers.delete(guildId);
            }
            
            if (queue) {
                queue.clear();
                global.queues.delete(guildId);
            }
            
            // Safely destroy connection
            if (connection) {
                try {
                    if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                        connection.destroy();
                    }
                    global.connections?.delete(guildId);
                } catch (error) {
                    console.log(`Leave command cleanup warning: ${error.message}`);
                    global.connections?.delete(guildId);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('👋 Successfully Disconnected')
                .setDescription('Voice channel से disconnect हो गया!')
                .setColor('#00ff00')
                .setFooter({ text: 'Queue cleared and music stopped' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            console.log(`🚪 Bot left voice channel in guild ${guildId}`);

        } catch (error) {
            console.error('Leave command error:', error);
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Error')
                .setDescription('Disconnect करने में problem हुई, लेकिन bot को manually cleanup कर दिया!')
                .setColor('#ff9900');
            
            await interaction.reply({ embeds: [embed] });
        }
    },
};