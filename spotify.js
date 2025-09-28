const { SpotifyApi } = require("@spotify/web-api-ts-sdk");

let connectionSettings;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=spotify',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);
   const refreshToken =
    connectionSettings?.settings?.oauth?.credentials?.refresh_token;
  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
const clientId = connectionSettings?.settings?.oauth?.credentials?.client_id;
  const expiresIn = connectionSettings.settings?.oauth?.credentials?.expires_in;
  if (!connectionSettings || (!accessToken || !clientId || !refreshToken)) {
    throw new Error('Spotify not connected');
  }
  return {accessToken, clientId, refreshToken, expiresIn};
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
async function getUncachableSpotifyClient() {
  const {accessToken, clientId, refreshToken, expiresIn} = await getAccessToken();

  const spotify = SpotifyApi.withAccessToken(clientId, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn || 3600,
    refresh_token: refreshToken,
  });

  return spotify;
}

// Function to get YouTube URL from Spotify track
async function getYouTubeUrlFromSpotify(spotifyUrl) {
  try {
    const spotify = await getUncachableSpotifyClient();
    
    // Extract track ID from Spotify URL
    const trackId = spotifyUrl.split('/track/')[1]?.split('?')[0];
    if (!trackId) {
      throw new Error('Invalid Spotify URL');
    }
    
    // Get track details from Spotify
    const track = await spotify.tracks.get(trackId);
    
    // Create search query for YouTube
    const searchQuery = `${track.artists[0].name} ${track.name}`;
    
    return {
      searchQuery,
      title: track.name,
      artist: track.artists[0].name,
      duration: Math.floor(track.duration_ms / 1000),
      thumbnail: track.album.images[0]?.url,
      spotifyUrl: track.external_urls.spotify
    };
  } catch (error) {
    console.error('Error getting Spotify track info:', error);
    throw error;
  }
}

// Function to search Spotify playlists
async function searchSpotifyPlaylist(playlistUrl) {
  try {
    const spotify = await getUncachableSpotifyClient();
    
    // Extract playlist ID from Spotify URL
    const playlistId = playlistUrl.split('/playlist/')[1]?.split('?')[0];
    if (!playlistId) {
      throw new Error('Invalid Spotify playlist URL');
    }
    
    // Get playlist details and tracks
    const playlist = await spotify.playlists.getPlaylistItems(playlistId, 'IN', undefined, 50);
    
    const tracks = playlist.items
      .filter(item => item.track && item.track.type === 'track')
      .map(item => ({
        searchQuery: `${item.track.artists[0].name} ${item.track.name}`,
        title: item.track.name,
        artist: item.track.artists[0].name,
        duration: Math.floor(item.track.duration_ms / 1000),
        thumbnail: item.track.album.images[0]?.url,
        spotifyUrl: item.track.external_urls.spotify
      }));
    
    return {
      playlistName: playlist.name || 'Spotify Playlist',
      tracks
    };
  } catch (error) {
    console.error('Error getting Spotify playlist:', error);
    throw error;
  }
}

module.exports = {
  getUncachableSpotifyClient,
  getYouTubeUrlFromSpotify,
  searchSpotifyPlaylist
};