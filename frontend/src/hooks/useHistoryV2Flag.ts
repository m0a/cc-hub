import { useEffect, useState } from "react";

const STORAGE_KEY = "cchub-history-v2";

function readFlag(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

/**
 * Session History V2 feature flag.
 *
 * Reads `cchub-history-v2` from localStorage and returns whether the new
 * faceted/virtualized history UI should be shown. Listens for the storage
 * event so toggling the flag in another tab updates this one live.
 *
 * Default is `false` (opt-in). PR6 will flip the unset default to `true`.
 */
export function useHistoryV2Flag(): boolean {
	const [enabled, setEnabled] = useState<boolean>(() => readFlag());

	useEffect(() => {
		function onStorage(e: StorageEvent) {
			if (e.key === STORAGE_KEY || e.key === null) {
				setEnabled(readFlag());
			}
		}
		window.addEventListener("storage", onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
		};
	}, []);

	return enabled;
}
