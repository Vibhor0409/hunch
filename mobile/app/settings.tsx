// Settings: the play-money wallet, the amount per trade, a reset for demos, and the
// wallet's activity. Pushed from the gear on the Me tab.

import { router, useFocusEffect } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Keyboard, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { BrandStrip } from "@/components/BrandStrip";
import { formatInt, formatMoney, formatSignedMoney, formatWhen } from "@/components/format";
import { usePlayer } from "@/components/PlayerContext";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateViews";
import { errorMessage, getWallet, isAbort, resetWallet, setStakePerTrade } from "@/lib/api";
import { colors, hit, radii, shadows, space, type } from "@/lib/theme";
import type { Wallet, WalletTx } from "@/lib/types";

type Phase = "loading" | "ready" | "error";

const PRESETS = [1, 2, 5, 10, 25];
const MIN_STAKE = 1;
const MAX_STAKE = 100;

export default function SettingsScreen() {
  const { playerId } = usePlayer();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const hasData = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (pull: boolean) => {
      if (!playerId) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (pull) setRefreshing(true);
      else if (!hasData.current) setPhase("loading");
      try {
        const res = await getWallet(playerId, controller.signal);
        if (controller.signal.aborted) return;
        hasData.current = true;
        setWallet(res);
        setNow(Date.now());
        setNotice("");
        setPhase("ready");
      } catch (err) {
        if (isAbort(err)) return;
        if (hasData.current) setNotice(errorMessage(err));
        else {
          setError(errorMessage(err));
          setPhase("error");
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    },
    [playerId],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
      return () => abortRef.current?.abort();
    }, [load]),
  );

  const onStakeSaved = useCallback((stake: number) => {
    setWallet((w) => (w ? { ...w, stakePerTrade: stake } : w));
  }, []);

  const onReset = useCallback((next: Wallet) => {
    setWallet(next);
    setNow(Date.now());
  }, []);

  const renderItem = useCallback(({ item }: { item: WalletTx }) => <TxRow tx={item} now={now} />, [now]);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="M14.5 5.5L8 12l6.5 6.5" stroke={colors.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <Text style={styles.backText}>Me</Text>
        </Pressable>
        <Text style={styles.navTitle}>Settings</Text>
        <View style={styles.navSpacer} />
      </View>

      {phase === "loading" ? <LoadingView label="Opening your wallet" /> : null}
      {phase === "error" ? <ErrorView message={error} onRetry={() => load(true)} refreshing={refreshing} /> : null}
      {phase === "ready" && wallet && playerId ? (
        <FlatList
          data={wallet.transactions}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.ink2} />}
          ListHeaderComponent={
            <View style={styles.headerGap}>
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <View style={styles.walletCard}>
                <Text style={styles.walletLabel}>Wallet</Text>
                <Text testID="wallet-balance" style={styles.balance}>
                  {formatMoney(wallet.balance)}
                </Text>
                <Text style={styles.walletNote}>Play money for the demo. Not real, not redeemable.</Text>
              </View>

              <StakePicker playerId={playerId} current={wallet.stakePerTrade} onSaved={onStakeSaved} />

              <ResetWallet playerId={playerId} startingBalance={wallet.startingBalance} onReset={onReset} />

              <BrandStrip style={styles.brand} />

              <Text style={styles.sectionTitle}>Activity</Text>
            </View>
          }
          ListEmptyComponent={<EmptyView title="No activity yet." hint="Paid swipes and payouts show up here." />}
          renderItem={renderItem}
          initialNumToRender={12}
          windowSize={7}
        />
      ) : null}
    </SafeAreaView>
  );
}

function keyExtractor(tx: WalletTx): string {
  return tx.id;
}

/** Preset chips plus a custom field. Saves to the server and shows what it saved. */
function StakePicker({ playerId, current, onSaved }: { playerId: string; current: number; onSaved: (stake: number) => void }) {
  const [custom, setCustom] = useState(PRESETS.includes(current) ? "" : String(current));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flash = (text: string, error: boolean) => {
    setMessage({ text, error });
    if (timer.current) clearTimeout(timer.current);
    if (!error) timer.current = setTimeout(() => setMessage(null), 2200);
  };

  const save = async (value: number) => {
    if (saving) return;
    if (!Number.isInteger(value) || value < MIN_STAKE || value > MAX_STAKE) {
      flash(`Pick a whole amount from $${MIN_STAKE} to $${MAX_STAKE}.`, true);
      return;
    }
    if (value === current) {
      flash(`Saved. $${value} per trade.`, false);
      return;
    }
    setSaving(true);
    try {
      const status = await setStakePerTrade(playerId, value);
      const saved = typeof status.stakePerTrade === "number" ? status.stakePerTrade : value;
      onSaved(saved);
      setCustom(PRESETS.includes(saved) ? "" : String(saved));
      flash(`Saved. $${saved} per trade.`, false);
    } catch (err) {
      flash(errorMessage(err), true);
    } finally {
      setSaving(false);
    }
  };

  const customValue = custom.trim() === "" ? null : Number(custom);
  const customSelected = customValue !== null && customValue === current && !PRESETS.includes(current);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Amount per trade</Text>
      <Text style={styles.sectionHint}>Spent from your wallet on each paid swipe.</Text>
      <View style={styles.chips}>
        {PRESETS.map((value) => {
          const selected = value === current;
          return (
            <Pressable
              key={value}
              testID={`stake-option-${value}`}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: saving }}
              disabled={saving}
              onPress={() => {
                Keyboard.dismiss();
                setCustom("");
                save(value);
              }}
              style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>${value}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.customRow}>
        <View style={[styles.customField, customSelected && styles.customFieldSelected]}>
          <Text style={styles.customPrefix}>$</Text>
          <TextInput
            testID="stake-custom"
            value={custom}
            onChangeText={(t) => setCustom(t.replace(/[^0-9]/g, "").slice(0, 3))}
            onBlur={() => {
              if (customValue !== null) save(customValue);
            }}
            onSubmitEditing={() => {
              if (customValue !== null) save(customValue);
            }}
            placeholder="Custom"
            placeholderTextColor={colors.ink3}
            keyboardType="number-pad"
            returnKeyType="done"
            editable={!saving}
            accessibilityLabel="Custom amount per trade"
            style={styles.customInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || customValue === null }}
          disabled={saving || customValue === null}
          onPress={() => {
            Keyboard.dismiss();
            if (customValue !== null) save(customValue);
          }}
          style={({ pressed }) => [styles.saveButton, (saving || customValue === null) && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.saveText}>{saving ? "Saving" : "Save"}</Text>
        </Pressable>
      </View>
      <Text style={[styles.sectionHint, message?.error && styles.errorText]}>
        {message ? message.text : `$${formatInt(current)} per trade, from $${MIN_STAKE} to $${MAX_STAKE}.`}
      </Text>
    </View>
  );
}

/** Reset with an in-app confirm step. No system dialogs. */
function ResetWallet({ playerId, startingBalance, onReset }: { playerId: string; startingBalance: number; onReset: (wallet: Wallet) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const amount = formatMoney(startingBalance).replace(/\.00$/, "");

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const wallet = await resetWallet(playerId);
      onReset(wallet);
      setConfirming(false);
      setMessage(`Wallet reset to ${amount}.`);
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      {confirming ? (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>Reset your balance to {amount}?</Text>
          <View style={styles.confirmButtons}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirming(false)}
              disabled={busy}
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>Keep it</Text>
            </Pressable>
            <Pressable
              testID="wallet-reset"
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              onPress={reset}
              disabled={busy}
              style={({ pressed }) => [styles.danger, busy && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={styles.dangerText}>{busy ? "Resetting" : "Reset"}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          testID="wallet-reset"
          accessibilityRole="button"
          onPress={() => {
            setMessage(null);
            setConfirming(true);
          }}
          style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
        >
          <Text style={styles.ghostText}>Reset wallet to {amount}</Text>
        </Pressable>
      )}
      {message ? <Text style={styles.sectionHint}>{message}</Text> : null}
    </View>
  );
}

const TxRow = memo(function TxRow({ tx, now }: { tx: WalletTx; now: number }) {
  const positive = tx.amount > 0;
  const label = tx.note ?? (tx.kind === "stake" ? "Paid swipe" : tx.kind === "payout" ? "Payout" : "Wallet reset");
  return (
    <View testID="wallet-tx" style={styles.tx}>
      <View style={styles.txBody}>
        <Text style={styles.txNote} numberOfLines={2}>
          {label}
        </Text>
        <Text style={styles.txMeta}>
          {formatWhen(tx.createdAt, now)}, balance {formatMoney(tx.balanceAfter)}
        </Text>
      </View>
      <Text style={[styles.txAmount, positive && styles.txAmountPositive]}>{formatSignedMoney(tx.amount)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  nav: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.md, minHeight: 48 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: hit.min, paddingRight: space.sm, minWidth: 72 },
  backText: { ...type.body, fontWeight: "600" },
  navTitle: { ...type.heading, flex: 1, textAlign: "center" },
  navSpacer: { minWidth: 72 },
  list: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.huge, flexGrow: 1 },
  headerGap: { gap: space.xl, marginBottom: space.sm },
  notice: { ...type.small, color: colors.no },
  walletCard: {
    padding: space.xl,
    gap: space.xs,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card,
  },
  walletLabel: { ...type.caption, color: colors.ink2 },
  balance: { ...type.hero, fontSize: 48, lineHeight: 54, letterSpacing: -1.6 },
  walletNote: { ...type.small, marginTop: space.xs },
  section: { gap: space.sm },
  sectionTitle: { ...type.heading },
  sectionHint: { ...type.small, color: colors.ink3, fontVariant: ["tabular-nums"] },
  errorText: { color: colors.no },
  chips: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  chip: {
    flex: 1,
    height: hit.min,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { ...type.body, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chipTextSelected: { color: colors.onInk },
  customRow: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  customField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 50,
    paddingHorizontal: space.lg,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.card,
  },
  customFieldSelected: { borderColor: colors.ink },
  customPrefix: { ...type.heading, color: colors.ink2, marginRight: 2 },
  customInput: { ...type.heading, flex: 1, height: 48, padding: 0, fontVariant: ["tabular-nums"] },
  saveButton: {
    minWidth: 92,
    height: 50,
    paddingHorizontal: space.lg,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { ...type.heading, color: colors.onInk },
  confirmRow: { gap: space.sm },
  confirmText: { ...type.body },
  confirmButtons: { flexDirection: "row", gap: space.sm },
  ghost: {
    flex: 1,
    minHeight: 50,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { ...type.heading, color: colors.ink },
  danger: {
    flex: 1,
    minHeight: 50,
    borderRadius: radii.button,
    backgroundColor: colors.no,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: { ...type.heading, color: colors.onInk },
  brand: { marginTop: space.xs },
  tx: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  txBody: { flex: 1, gap: 2 },
  txNote: { ...type.body },
  txMeta: { ...type.caption, fontVariant: ["tabular-nums"] },
  txAmount: { ...type.heading, color: colors.ink2, fontVariant: ["tabular-nums"] },
  txAmountPositive: { color: colors.accentDeep },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
