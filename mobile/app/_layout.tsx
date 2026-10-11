// Root layout: gesture root, safe areas, dark status bar, player gate and lazy settlement.

import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PlayerContext } from "@/components/PlayerContext";
import { settle } from "@/lib/api";
import { getPlayerId } from "@/lib/storage";
import { colors } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.paper,
    border: colors.line,
    notification: colors.accent,
  },
};

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

  // Lazy settlement: on launch and whenever the app returns to the foreground.
  // Failures are ignored on purpose; the tabs settle again when they open.
  useEffect(() => {
    settle().catch(() => {});
    let last = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && last !== "active") {
        settle().catch(() => {});
      }
      last = next;
    });
    return () => sub.remove();
  }, []);

  const value = useMemo(
    () => ({
      playerId: playerId ?? null,
      setPlayerId: (id: string | null) => setPlayerIdState(id),
    }),
    [playerId],
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <PlayerContext.Provider value={value}>
            <StatusBar style="light" />
            {playerId === undefined ? (
              <View style={styles.root} />
            ) : (
              <Stack screenOptions={{ headerShown: false, contentStyle: styles.root }}>
                <Stack.Protected guard={playerId !== null}>
                  <Stack.Screen name="(tabs)" />
                </Stack.Protected>
                <Stack.Protected guard={playerId === null}>
                  <Stack.Screen name="join" />
                </Stack.Protected>
              </Stack>
            )}
          </PlayerContext.Provider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
