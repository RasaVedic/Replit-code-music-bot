# Overview

This is a Discord music bot built with Node.js that allows users to play YouTube audio in Discord voice channels. The bot provides comprehensive music functionality including play, pause, resume, skip, stop, queue management, and volume control. It uses Discord.js v14 for Discord API interaction, Discord.js/voice for voice channel functionality, and ytdl-core for YouTube audio streaming. The bot supports Hindi language responses for user interaction.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Bot Architecture
The application follows a command-based architecture using Discord.js slash commands. The main entry point (`index.js`) initializes the Discord client with necessary intents for guild, voice state, and message interactions. Commands are modularized into separate files within the `commands` directory and loaded dynamically at startup.

## Music System Design
The core music functionality is built around a guild-specific queue system using JavaScript Maps for data storage. Each guild has its own `MusicQueue` instance that manages songs, playback state, volume, and loop settings. The system uses Discord.js voice connections and audio players to handle voice channel interaction and audio streaming.

## Command Structure
Commands are implemented as individual modules following Discord's slash command pattern. Each command exports a data object (using SlashCommandBuilder) and an execute function. The bot automatically discovers and registers commands from the `commands` directory, supporting hot-loading of new command files.

## Audio Processing
Audio streaming is handled through ytdl-core for YouTube content extraction and Discord.js audio resources for playback. The system creates audio players per guild and manages voice connections with proper error handling and connection state monitoring.

## State Management
The bot maintains persistent state through in-memory storage using JavaScript Maps. Music queues, audio players, and voice connections are stored globally and accessed through guild IDs. This approach provides fast access but doesn't persist across bot restarts.

# External Dependencies

## Core Discord Libraries
- **discord.js v14**: Primary Discord API interaction and slash command handling
- **@discordjs/voice**: Voice channel connection, audio player management, and voice state handling
- **tweetnacl**: Cryptographic library required for Discord voice connections

## Audio Processing
- **ytdl-core**: YouTube video information extraction and audio stream generation for music playback

## System Dependencies  
- **Node.js File System (fs)**: Dynamic command loading and directory management
- **Node.js Path**: File path resolution for command discovery and loading

The bot requires Discord Bot Token configuration and appropriate Discord application permissions including voice channel access, message sending, and slash command registration.