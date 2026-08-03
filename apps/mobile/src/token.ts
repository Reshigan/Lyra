import * as SecureStore from "expo-secure-store";

// The session token lives in the platform keystore (iOS keychain / Android
// EncryptedSharedPreferences), never in AsyncStorage and never in a module
// variable that survives a bundle reload. docs/08 §6.

const KEY = "lyra.session.token";

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token, {
    // Only readable while the device is unlocked, and never restored onto a
    // different device from an iCloud backup.
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

/** `null` when there is no stored session — including when the keystore is
 *  unreadable, which is indistinguishable from signed-out for our purposes. */
export async function readToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* nothing stored, or the keystore is gone; either way there is no session */
  }
}

// Recovery codes are readable exactly once, and the factor is already cleared
// server-side by the time they arrive — an app kill on the recovery screen
// would lose them forever. So they live in the keystore from the moment they
// arrive until the user confirms they saved them.

const CODES_KEY = "lyra.mfa.pendingRecoveryCodes";

export async function savePendingRecoveryCodes(codes: string[]): Promise<void> {
  await SecureStore.setItemAsync(CODES_KEY, JSON.stringify(codes), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

/** `null` when nothing is pending — including an unreadable keystore or a
 *  value that is not a list of codes. */
export async function readPendingRecoveryCodes(): Promise<string[] | null> {
  try {
    const raw = await SecureStore.getItemAsync(CODES_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((code) => typeof code === "string")
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

export async function clearPendingRecoveryCodes(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CODES_KEY);
  } catch {
    /* nothing pending, or the keystore is gone */
  }
}
