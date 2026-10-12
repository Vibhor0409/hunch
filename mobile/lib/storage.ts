// Device storage for Hunch: the player id and the session mode.

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

// Session mode: Practice (no money moves) or Live (wallet and Gemini sandbox orders).

const SESSION_MODE_KEY = "hunch.sessionMode";

export type SessionMode = "practice" | "live";

/** The saved session mode. Live until the player picks otherwise. */
export async function getSessionMode(): Promise<SessionMode> {
  try {
    const value = await AsyncStorage.getItem(SESSION_MODE_KEY);
    return value === "practice" ? "practice" : "live";
  } catch {
    return "live";
  }
}

export async function setSessionMode(mode: SessionMode): Promise<void> {
  await AsyncStorage.setItem(SESSION_MODE_KEY, mode);
}
