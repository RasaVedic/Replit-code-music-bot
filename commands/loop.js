const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Current गाना या queue को loop करें')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Loop mode choose करें')
                .setRequired(true)
                .addChoices(
                    { name: 'Song - Current गाना repeat करें', value: 'song' },
                    { name: 'Off - Loop off करें', value: 'off' }
                )
        ),

    async execute(interaction) {
        const queue = global.getQueue(interaction.guild.id);
        const mode = interaction.options.getString('mode');
        
        if (!queue.nowPlaying && queue.isEmpty()) {
            return interaction.reply({ 
                content: '❌ कोई गाना play नहीं हो रहा है!', 
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        switch (mode) {
            case 'song':
                queue.loop = true;
                await interaction.reply('🔂 Current song को loop mode पर set कर दिया!');
                break;
            case 'off':
                queue.loop = false;
                await interaction.reply('➡️ Loop mode off कर दिया!');
                break;
        }
    },
};