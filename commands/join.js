const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Bot को voice channel में join करें'),

    async execute(interaction) {
        const member = interaction.member;
        if (!member) {
            return interaction.reply({ 
                content: '❌ Member information not available. Please try again.',
                flags: 64 // MessageFlags.Ephemeral
            });
        }
        
        const voiceChannel = member.voice?.channel;

        if (!voiceChannel) {
            return interaction.reply({ 
                content: '❌ आपको पहले किसी voice channel में join करना होगा!', 
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({ 
                content: '❌ मुझे voice channel में जाने की permission नहीं है!', 
                flags: 64 // MessageFlags.Ephemeral
            });
        }

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            // Subscribe the audio player to the voice connection
            const player = global.createGuildAudioPlayer(interaction.guild.id);
            connection.subscribe(player);

            connection.on(VoiceConnectionStatus.Ready, () => {
                console.log(`[${interaction.guild.id}] Voice connection ready`);
            });

            await interaction.reply(`🎵 **${voiceChannel.name}** में join हो गया!`);
        } catch (error) {
            console.error('Voice connection error:', error);
            await interaction.reply({ 
                content: '❌ Voice channel join करने में error हुई!', 
                flags: 64 // MessageFlags.Ephemeral
            });
        }
    },
};