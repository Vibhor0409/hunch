// Three tabs: Deck, Leaderboard, Me.

import { Tabs } from "expo-router/js-tabs";
import { StyleSheet } from "react-native";

import { TabIcon } from "@/components/TabIcon";
import { colors } from "@/lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: styles.scene,
        tabBarStyle: styles.bar,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.ink3,
        tabBarLabelStyle: styles.label,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Deck",
          tabBarIcon: ({ color }) => <TabIcon name="deck" color={color} />,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: "Leaderboard",
          tabBarIcon: ({ color }) => <TabIcon name="leaderboard" color={color} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
          tabBarIcon: ({ color }) => <TabIcon name="me" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: "transparent" },
  bar: {
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 11, fontWeight: "700" },
});
