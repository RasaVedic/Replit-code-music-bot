const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Music का volume set करें (0-100)')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Volume level (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
        ),

    async execute(interaction) {
        const volume = interaction.options.getInteger('level');
        const queue = global.getQueue(interaction.guild.id);
        
        if (!queue.nowPlaying) {
            return interaction.reply({ 
                content: '❌ कोई गाना play नहीं हो रहा है!', 
                ephemeral: true 
            });
        }

        // Convert 0-100 to 0-1 for Discord.js
        const volumeDecimal = volume / 100;
        queue.volume = volumeDecimal;

        // Get current resource and update volume
        const player = global.createGuildAudioPlayer(interaction.guild.id);
        if (player.state.resource) {
            player.state.resource.volume?.setVolume(volumeDecimal);
        }

        await interaction.reply(`🔊 Volume को ${volume}% set कर दिया!`);
    },
};