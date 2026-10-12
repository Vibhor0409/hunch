// Root layout: paper background with grain, gesture root, safe areas, dark status bar
// text, the player gate, and lazy settlement that never blocks the first paint.

import { DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { AppState, Image, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PlayerContext } from "@/components/PlayerContext";
import { SessionModeProvider } from "@/components/SessionMode";
import { settle } from "@/lib/api";
import { getPlayerId } from "@/lib/storage";
import { colors } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

const grain = require("@/assets/images/grain.png");

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.ink,
    background: "transparent",
    card: colors.card,
    text: colors.ink,
    border: colors.line,
    notification: colors.accent,
  },
};

// Settle in the background. Never awaited by anything that renders.
function settleLater(delayMs: number): () => void {
  const t = setTimeout(() => {
    settle().catch(() => {});
  }, delayMs);
  return () => clearTimeout(t);
}

export default function RootLayout() {
  // undefined while storage is being read, null when nobody has joined on this device.
  const [playerId, setPlayerIdState] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getPlayerId().then((id) => {
      if (!cancelled) setPlayerIdState(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (playerId === undefined) return;
    SplashScreen.hideAsync().catch(() => {});
  }, [playerId]);

  // Lazy settlement: shortly after launch and whenever the app returns to the foreground.
  // Fire and forget; the tabs reload themselves when a settle lands.
  useEffect(() => {
    let cancel = settleLater(600);
    let last = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && last !== "active") {
        cancel();
        cancel = settleLater(300);
      }
      last = next;
    });
    return () => {
      cancel();
      sub.remove();
    };
  }, []);

  const value = useMemo(
    () => ({
      playerId: playerId ?? null,
      setPlayerId: (id: string | null) => setPlayerIdState(id),
    }),
    [playerId],
  );

  return (
    <View style={styles.paper}>
      <Image source={grain} resizeMode="repeat" style={styles.grain} accessible={false} />
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <ThemeProvider value={navTheme}>
            <PlayerContext.Provider value={value}>
              <SessionModeProvider>
              <StatusBar style="dark" />
              {playerId === undefined ? (
                <View style={styles.root} />
              ) : (
                <Stack screenOptions={{ headerShown: false, contentStyle: styles.root }}>
                  <Stack.Protected guard={playerId !== null}>
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="settings" />
                  </Stack.Protected>
                  <Stack.Protected guard={playerId === null}>
                    <Stack.Screen name="join" />
                  </Stack.Protected>
                </Stack>
              )}
              </SessionModeProvider>
            </PlayerContext.Provider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { flex: 1, backgroundColor: colors.paper },
  grain: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: undefined,
    height: undefined,
    opacity: 0.9,
    pointerEvents: "none",
  },
  root: { flex: 1, backgroundColor: "transparent" },
});
