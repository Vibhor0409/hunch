Do not put files here. capture/ and audio/ are symlinks to ../capture and ../audio,
which is where the screen recordings (video/capture/<clip>.mp4) and the ElevenLabs
voiceover (video/audio/<scene>.mp3, video/audio/counters.json) live. Remotion's
staticFile("capture/intro.mp4") resolves through the link; the bundler forwards
symlinks into the render bundle.
