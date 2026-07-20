import { LOCAL_PEER_ID } from "../../../shared/types";
import { authFetch } from "../services/api";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface UploadImageResult {
	ok: boolean;
	/** Path on the host that owns the destination Claude Code session.
	 *  This is what gets typed into the session's terminal pane. */
	path?: string;
	filename?: string;
	error?: string;
}

/**
 * Upload an image and get back a path that the agent on the **same host as
 * the active session** can read. When `peerId` is local (or unset) the Hub
 * stores it locally; for remote peers the upload is proxied to that peer so
 * the file lands on the peer's disk.
 */
export async function uploadImage(
	file: File | Blob,
	peerId?: string,
	filenameHint = "image.png",
): Promise<UploadImageResult> {
	const formData = new FormData();
	if (file instanceof File) {
		formData.append("image", file);
	} else {
		formData.append("image", file, filenameHint);
	}

	const isRemote = peerId && peerId !== LOCAL_PEER_ID;
	const url = isRemote
		? `${API_BASE}/api/peers/${encodeURIComponent(peerId)}/upload/image`
		: `${API_BASE}/api/upload/image`;

	try {
		const response = await authFetch(url, { method: "POST", body: formData });
		const json = (await response.json().catch(() => ({}))) as {
			path?: string;
			filename?: string;
			error?: string;
		};
		if (!response.ok || !json.path) {
			return { ok: false, error: json.error ?? `HTTP ${response.status}` };
		}
		return { ok: true, path: json.path, filename: json.filename };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Network error",
		};
	}
}
