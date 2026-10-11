// Join: the mark, the brand strip, one line of pitch, a name, Start. Five seconds, then the deck.

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

import { BrandStrip } from "@/components/BrandStrip";
import { HunchMark } from "@/components/HunchMark";
import { usePlayer } from "@/components/PlayerContext";
import { ApiError, errorMessage, join } from "@/lib/api";
import { setPlayerId as storePlayerId } from "@/lib/storage";
import { colors, radii, shadows, space, type } from "@/lib/theme";

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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.hero}>
          <HunchMark size={112} />
          <Text style={styles.wordmark}>Hunch</Text>
          <BrandStrip style={styles.brand} />
          <Text style={styles.pitch}>Call live markets blind. Beat them to earn a bigger limit.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Your name</Text>
          <TextInput
            testID="join-name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (error) setError(null);
            }}
            placeholder="Two to twenty characters"
            placeholderTextColor={colors.ink3}
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
          <Text style={[styles.helper, error ? styles.errorText : null]}>{error ?? "Letters, digits and spaces."}</Text>

          <Pressable
            testID="join-start"
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid || busy }}
            disabled={!valid || busy}
            onPress={onStart}
            style={({ pressed }) => [styles.start, (!valid || busy) && styles.startDisabled, pressed && styles.pressed]}
          >
            {busy ? <ActivityIndicator color={colors.onInk} /> : <Text style={styles.startText}>Start</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, paddingHorizontal: space.xxl },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.sm },
  wordmark: {
    ...type.title,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -1.6,
    marginTop: space.xs,
  },
  brand: { marginTop: space.xs, maxWidth: 320 },
  pitch: { ...type.body, color: colors.ink2, textAlign: "center", maxWidth: 300, marginTop: space.lg, fontSize: 17, lineHeight: 24 },
  form: { gap: space.sm, paddingBottom: space.xl },
  fieldLabel: { ...type.caption, color: colors.ink2 },
  input: {
    ...type.title,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "700",
    minHeight: 58,
    paddingHorizontal: space.lg,
    borderRadius: radii.button,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    ...shadows.tile,
  },
  inputError: { borderColor: colors.no },
  helper: { ...type.small, color: colors.ink3 },
  errorText: { color: colors.no },
  start: {
    marginTop: space.sm,
    minHeight: 58,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  startDisabled: { opacity: 0.35 },
  startText: { ...type.heading, color: colors.onInk, fontSize: 18 },
  pressed: { opacity: 0.8 },
});
