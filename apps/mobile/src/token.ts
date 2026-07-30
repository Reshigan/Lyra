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
