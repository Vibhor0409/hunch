// Session mode: Practice (no money moves) or Live (play-money wallet and Gemini
// sandbox orders). The choice is saved on the device and shared by the Deck and
// Settings through this context. SessionToggle is the two-segment control both show.

import * as Haptics from "expo-haptics";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getSessionMode, setSessionMode as storeSessionMode, type SessionMode } from "@/lib/storage";
import { colors, radii, shadows, space, type } from "@/lib/theme";

interface SessionModeValue {
  mode: SessionMode;
  setMode: (mode: SessionMode) => void;
}

// Live is the default: it is how the app behaved before the toggle existed.
const SessionModeContext = createContext<SessionModeValue>({ mode: "live", setMode: () => {} });

export function useSessionMode(): SessionModeValue {
  return useContext(SessionModeContext);
}

export function SessionModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<SessionMode>("live");

  // Storage answers in a few milliseconds, well before the first feed arrives,
  // so no card can be swiped under the default by mistake.
  useEffect(() => {
    let cancelled = false;
    getSessionMode().then((saved) => {
      if (!cancelled) setModeState(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: SessionMode) => {
    setModeState(next);
    // If the save fails the choice still holds until the app closes.
    storeSessionMode(next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <SessionModeContext.Provider value={value}>{children}</SessionModeContext.Provider>;
}

const OPTIONS: { key: SessionMode; label: string }[] = [
  { key: "practice", label: "Practice" },
  { key: "live", label: "Live" },
];

const EXPLAINERS: Record<SessionMode, string> = {
  live: "Live: uses your play-money wallet and places Gemini sandbox orders.",
  practice: "Practice: no money moves. Calls still score Edge.",
};

const PAD = 3;

/** Practice | Live, with one line under it saying what the selection does. */
export const SessionToggle = memo(function SessionToggle() {
  const { mode, setMode } = useSessionMode();

  return (
    <View style={styles.wrap}>
      <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel="Session">
        {OPTIONS.map((option) => {
          const selected = option.key === mode;
          return (
            <Pressable
              key={option.key}
              testID={`mode-${option.key}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, selected }}
              hitSlop={{ top: 6, bottom: 6 }}
              onPress={() => {
                if (selected) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setMode(option.key);
              }}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text style={[styles.text, selected && styles.textSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.explainer} numberOfLines={2}>
        {EXPLAINERS[mode]}
      </Text>
    </View>
  );
});

// Same language as the lane control: a recessed pill track with a raised selection.
const styles = StyleSheet.create({
  wrap: { gap: 6 },
  track: {
    flexDirection: "row",
    alignItems: "stretch",
    padding: PAD,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.paperDeep,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  segmentSelected: { backgroundColor: colors.card, ...shadows.tile },
  text: { fontSize: 13, lineHeight: 16, fontWeight: "600", color: colors.ink2 },
  textSelected: { color: colors.ink, fontWeight: "700" },
  // Two lines are always reserved, so switching modes never moves the deck.
  explainer: { ...type.caption, color: colors.ink2, minHeight: 32, paddingHorizontal: space.xs },
});
