// Join: the mark, one line of pitch, a name, Start. Five seconds, then the deck.

import { useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { HunchMark } from "@/components/HunchMark";
import { usePlayer } from "@/components/PlayerContext";
import { ApiError, errorMessage, join } from "@/lib/api";
import { setPlayerId as storePlayerId } from "@/lib/storage";
import { colors, credit, hit, radii, space, type } from "@/lib/theme";

const NAME_RE = /^[A-Za-z0-9 ]{2,20}$/;

function isValidName(raw: string): boolean {
  const name = raw.trim();
  return NAME_RE.test(name) && /[A-Za-z0-9]/.test(name);
}

export default function JoinScreen() {
  const { setPlayerId } = usePlayer();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = isValidName(name);

  async function onStart() {
    if (!valid || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      const res = await join(name.trim());
      await storePlayerId(res.playerId);
      setPlayerId(res.playerId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.hero}>
          <HunchMark size={112} />
          <Text style={styles.wordmark}>Hunch</Text>
          <Text style={styles.pitch}>Call live markets blind. Beat them to earn a bigger limit.</Text>
        </View>

        <View style={styles.form}>
          <Text style={type.label}>Your name</Text>
          <TextInput
            testID="join-name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (error) setError(null);
            }}
            placeholder="Two to twenty characters"
            placeholderTextColor={colors.faint}
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="off"
            maxLength={20}
            returnKeyType="go"
            onSubmitEditing={onStart}
            editable={!busy}
            style={[styles.input, error ? styles.inputError : null]}
            accessibilityLabel="Your name"
          />
          <Text style={[type.small, error ? styles.errorText : null]}>
            {error ?? "Letters, digits and spaces."}
          </Text>

          <Pressable
            testID="join-start"
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid || busy }}
            disabled={!valid || busy}
            onPress={onStart}
            style={({ pressed }) => [
              styles.start,
              (!valid || busy) && styles.startDisabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.startText}>Start</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.footer}>{credit.builtOn}</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, paddingHorizontal: space.xxl },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md },
  wordmark: {
    ...type.display,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1.2,
    marginTop: space.sm,
  },
  pitch: { ...type.body, color: colors.muted, textAlign: "center", maxWidth: 300 },
  form: { gap: space.sm, paddingBottom: space.xl },
  input: {
    ...type.title,
    fontWeight: "600",
    minHeight: 56,
    paddingHorizontal: space.lg,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  inputError: { borderColor: colors.loss },
  errorText: { color: colors.loss },
  start: {
    marginTop: space.sm,
    minHeight: 56,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  startDisabled: { opacity: 0.4 },
  startText: { ...type.heading, color: colors.onAccent, fontSize: 18 },
  pressed: { opacity: 0.8 },
  footer: {
    ...type.small,
    color: colors.faint,
    textAlign: "center",
    minHeight: hit.min,
    paddingTop: space.md,
  },
});
