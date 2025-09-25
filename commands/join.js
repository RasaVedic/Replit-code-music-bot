const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Bot को voice channel में join करें'),

    async execute(interaction) {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ 
                content: '❌ आपको पहले किसी voice channel में join करना होगा!', 
                ephemeral: true 
            });
        }

        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({ 
                content: '❌ मुझे voice channel में जाने की permission नहीं है!', 
                ephemeral: true 
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
                ephemeral: true 
            });
        }
    },
};