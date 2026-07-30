import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../src/session";

// Everything hangs off one provider: the stored token, /v1/me, and the theme
// and locale that come out of it. Headers are off — each screen draws its own
// title from tenant brand and i18n keys, which a native header cannot do
// without duplicating both.

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Chrome />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function Chrome() {
  const { theme } = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
          animation: "slide_from_right"
        }}
      />
    </View>
  );
}
