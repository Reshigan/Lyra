import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { tabsFor } from "../../src/personas";
import { useSession } from "../../src/session";

type IconName = ComponentProps<typeof Ionicons>["name"];

export default function TabsLayout() {
  const session = useSession();
  const tabs = tabsFor(session.persona.workspace, session.persona.variant);
  const iconFor = (index: number, fallback: IconName): IconName => (tabs[index]?.icon as IconName) ?? fallback;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: session.theme.accent,
        tabBarInactiveTintColor: session.theme.muted,
        tabBarStyle: { backgroundColor: session.theme.surface, borderTopColor: session.theme.border }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tabs[0] ? session.t(tabs[0].labelKey) : "",
          ...(tabs[0] ? {} : { href: null }),
          tabBarIcon: ({ color, size }) => <Ionicons name={iconFor(0, "home")} color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="tab2"
        options={{
          title: tabs[1] ? session.t(tabs[1].labelKey) : "",
          ...(tabs[1] ? {} : { href: null }),
          tabBarIcon: ({ color, size }) => <Ionicons name={iconFor(1, "ellipse")} color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="tab3"
        options={{
          title: tabs[2] ? session.t(tabs[2].labelKey) : "",
          ...(tabs[2] ? {} : { href: null }),
          tabBarIcon: ({ color, size }) => <Ionicons name={iconFor(2, "ellipse")} color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: session.t("nav.more"),
          tabBarIcon: ({ color, size }) => <Ionicons name="menu" color={color} size={size} />
        }}
      />
    </Tabs>
  );
}
