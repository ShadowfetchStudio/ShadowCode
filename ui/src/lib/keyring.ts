import { api } from "../api";

/** After saving an API key, keep it in the desktop keyring (macOS Keychain
 * or Secret Service) when one is available. Failures are ignored: the key
 * already lives in the secrets file. */
export async function preferKeyring(name?: string) {
  try {
    const storage = await api.secretStorage();
    if (!storage.keyring.available) return;
    const targets = storage.keys.filter(
      (key) => key.place === "file" && (!name || key.name === name),
    );
    for (const key of targets) await api.moveSecret(key.name, "keyring");
  } catch {
    // The file copy is enough.
  }
}
