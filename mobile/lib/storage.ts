// Device storage for Hunch. Only the player id lives here.

import AsyncStorage from "@react-native-async-storage/async-storage";

const PLAYER_ID_KEY = "hunch.playerId";

export async function getPlayerId(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(PLAYER_ID_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function setPlayerId(playerId: string): Promise<void> {
  await AsyncStorage.setItem(PLAYER_ID_KEY, playerId);
}

export async function clearPlayerId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PLAYER_ID_KEY);
  } catch {
    // Nothing to clear.
  }
}
