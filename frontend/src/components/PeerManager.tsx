import { Plus, Trash2, RefreshCw, Pencil, Server, Wifi, WifiOff, AlertTriangle, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { LOCAL_PEER_ID, type PeerClientView } from "../../../shared/types";
import { usePeers } from "../hooks/usePeers";

const COLOR_OPTIONS = [
	"#10b981", "#3b82f6", "#f59e0b", "#ec4899",
	"#8b5cf6", "#06b6d4", "#f97316", "#84cc16",
	"#ef4444", "#a855f7", "#14b8a6", "#eab308",
];

function StatusBadge({ peer }: { peer: PeerClientView }) {
	if (peer.id === LOCAL_PEER_ID) {
		return (
			<span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 inline-flex items-center gap-1">
				<Server className="w-3 h-3" /> local
			</span>
		);
	}
	switch (peer.status) {
		case "online":
			return (
				<span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 inline-flex items-center gap-1">
					<Wifi className="w-3 h-3" /> online
				</span>
			);
		case "offline":
			return (
				<span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 inline-flex items-center gap-1">
					<WifiOff className="w-3 h-3" /> offline
				</span>
			);
		case "unauthorized":
			return (
				<span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300 inline-flex items-center gap-1">
					<AlertTriangle className="w-3 h-3" /> auth required
				</span>
			);
		default:
			return <span className="text-xs px-2 py-0.5 rounded-full bg-th-surface-hover text-th-text-muted">unknown</span>;
	}
}

function ColorSwatch({ color, selected, onClick }: { color: string; selected: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-7 h-7 rounded-full border-2 transition-transform ${
				selected ? "border-th-text scale-110" : "border-transparent hover:scale-105"
			}`}
			style={{ backgroundColor: color }}
			aria-label={`色 ${color}`}
		/>
	);
}

interface AddFormProps {
	onSubmit: (input: { nickname: string; url: string; password: string; color?: string }) => Promise<void>;
	onCancel: () => void;
}

function AddPeerForm({ onSubmit, onCancel }: AddFormProps) {
	const [nickname, setNickname] = useState("");
	const [url, setUrl] = useState("https://");
	const [password, setPassword] = useState("");
	const [color, setColor] = useState<string | undefined>(undefined);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			await onSubmit({ nickname, url, password, color });
		} catch (err) {
			setError(err instanceof Error ? err.message : "登録に失敗しました");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="bg-th-surface-hover border border-th-border rounded-md p-4 space-y-3">
			<div className="flex items-center justify-between mb-2">
				<h3 className="font-semibold text-th-text">サーバーを追加</h3>
				<button type="button" onClick={onCancel} className="text-th-text-muted hover:text-th-text">
					<X className="w-4 h-4" />
				</button>
			</div>
			<div>
				<label htmlFor="peer-nickname" className="block text-xs text-th-text-secondary mb-1">ニックネーム (絵文字OK)</label>
				<input
					id="peer-nickname"
					type="text"
					value={nickname}
					onChange={(e) => setNickname(e.target.value)}
					placeholder="💻 MacBook Air"
					required
					className="w-full px-3 py-2 bg-th-surface border border-th-border rounded-md text-th-text"
				/>
			</div>
			<div>
				<label htmlFor="peer-url" className="block text-xs text-th-text-secondary mb-1">URL</label>
				<input
					id="peer-url"
					type="url"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="https://mac.tailnet.ts.net:5923"
					required
					className="w-full px-3 py-2 bg-th-surface border border-th-border rounded-md text-th-text font-mono text-sm"
				/>
			</div>
			<div>
				<label htmlFor="peer-password" className="block text-xs text-th-text-secondary mb-1">そのサーバーのパスワード</label>
				<input
					id="peer-password"
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					required
					className="w-full px-3 py-2 bg-th-surface border border-th-border rounded-md text-th-text"
				/>
			</div>
			<div>
				<div className="block text-xs text-th-text-secondary mb-1">識別色 (省略可: 自動割当)</div>
				<div className="flex flex-wrap gap-2">
					{COLOR_OPTIONS.map((c) => (
						<ColorSwatch key={c} color={c} selected={color === c} onClick={() => setColor(c === color ? undefined : c)} />
					))}
				</div>
			</div>
			{error && <div className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{error}</div>}
			<div className="flex gap-2">
				<button
					type="submit"
					disabled={submitting}
					className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-medium rounded-md transition-colors"
				>
					{submitting ? "確認中…" : "追加"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="py-2 px-4 bg-th-surface hover:bg-th-surface-hover border border-th-border text-th-text rounded-md"
				>
					キャンセル
				</button>
			</div>
		</form>
	);
}

interface EditFormProps {
	peer: PeerClientView;
	onSubmit: (input: { nickname?: string; color?: string; password?: string }) => Promise<void>;
	onCancel: () => void;
}

function EditPeerForm({ peer, onSubmit, onCancel }: EditFormProps) {
	const [nickname, setNickname] = useState(peer.nickname);
	const [color, setColor] = useState(peer.color);
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const input: { nickname?: string; color?: string; password?: string } = {};
			if (nickname !== peer.nickname) input.nickname = nickname;
			if (color !== peer.color) input.color = color;
			if (password) input.password = password;
			await onSubmit(input);
		} catch (err) {
			setError(err instanceof Error ? err.message : "更新に失敗しました");
		} finally {
			setSubmitting(false);
		}
	};

	const isLocal = peer.id === LOCAL_PEER_ID;

	return (
		<form onSubmit={handleSubmit} className="bg-th-surface-hover border border-th-border rounded-md p-4 space-y-3">
			<div className="flex items-center justify-between mb-2">
				<h3 className="font-semibold text-th-text">サーバー編集</h3>
				<button type="button" onClick={onCancel} className="text-th-text-muted hover:text-th-text">
					<X className="w-4 h-4" />
				</button>
			</div>
			<div>
				<label htmlFor="edit-nickname" className="block text-xs text-th-text-secondary mb-1">ニックネーム</label>
				<input
					id="edit-nickname"
					type="text"
					value={nickname}
					onChange={(e) => setNickname(e.target.value)}
					required
					className="w-full px-3 py-2 bg-th-surface border border-th-border rounded-md text-th-text"
				/>
			</div>
			<div>
				<div className="block text-xs text-th-text-secondary mb-1">識別色</div>
				<div className="flex flex-wrap gap-2">
					{COLOR_OPTIONS.map((c) => (
						<ColorSwatch key={c} color={c} selected={color === c} onClick={() => setColor(c)} />
					))}
				</div>
			</div>
			{!isLocal && (
				<div>
					<label htmlFor="edit-password" className="block text-xs text-th-text-secondary mb-1">
						パスワード (再認証する場合のみ)
					</label>
					<input
						id="edit-password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						className="w-full px-3 py-2 bg-th-surface border border-th-border rounded-md text-th-text"
					/>
				</div>
			)}
			{error && <div className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{error}</div>}
			<div className="flex gap-2">
				<button
					type="submit"
					disabled={submitting}
					className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-medium rounded-md transition-colors"
				>
					{submitting ? "保存中…" : "保存"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="py-2 px-4 bg-th-surface hover:bg-th-surface-hover border border-th-border text-th-text rounded-md"
				>
					キャンセル
				</button>
			</div>
		</form>
	);
}

export function PeerManager() {
	const { peers, isLoading, error, refresh, addPeer, updatePeer, deletePeer, verifyPeer } = usePeers();
	const [adding, setAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [verifyingId, setVerifyingId] = useState<string | null>(null);

	const handleAdd = async (input: { nickname: string; url: string; password: string; color?: string }) => {
		await addPeer(input);
		setAdding(false);
	};

	const handleEdit = async (id: string, input: { nickname?: string; color?: string; password?: string }) => {
		await updatePeer(id, input);
		setEditingId(null);
	};

	const handleDelete = async (peer: PeerClientView) => {
		if (peer.id === LOCAL_PEER_ID) return;
		if (!confirm(`${peer.nickname} を削除しますか？`)) return;
		await deletePeer(peer.id);
	};

	const handleVerify = async (peer: PeerClientView) => {
		setVerifyingId(peer.id);
		try {
			await verifyPeer(peer.id);
		} catch {
			/* error 表示は peer.status に反映される */
		} finally {
			setVerifyingId(null);
		}
	};

	return (
		<div className="space-y-4 p-4">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold text-th-text">サーバー (Peers)</h2>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => void refresh()}
						className="p-2 rounded-md bg-th-surface-hover hover:bg-th-surface text-th-text-secondary"
						title="再読み込み"
					>
						<RefreshCw className="w-4 h-4" />
					</button>
					<button
						type="button"
						onClick={() => setAdding(true)}
						disabled={adding}
						className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm font-medium inline-flex items-center gap-1"
					>
						<Plus className="w-4 h-4" /> サーバー追加
					</button>
				</div>
			</div>

			{error && <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded">{error}</div>}

			{adding && <AddPeerForm onSubmit={handleAdd} onCancel={() => setAdding(false)} />}

			{isLoading ? (
				<div className="text-th-text-muted text-sm">読み込み中…</div>
			) : (
				<ul className="space-y-2">
					{peers.map((peer) => (
						<li
							key={peer.id}
							className="bg-th-surface border-l-4 border border-th-border rounded-md overflow-hidden"
							style={{ borderLeftColor: peer.color }}
						>
							{editingId === peer.id ? (
								<EditPeerForm
									peer={peer}
									onSubmit={(input) => handleEdit(peer.id, input)}
									onCancel={() => setEditingId(null)}
								/>
							) : (
								<div className="p-3 flex items-center justify-between gap-3">
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-medium text-th-text truncate">{peer.nickname}</span>
											<StatusBadge peer={peer} />
										</div>
										<div className="text-xs text-th-text-muted font-mono truncate mt-0.5">
											{peer.url === "self" ? "(this server)" : peer.url}
										</div>
										{peer.errorMessage && (
											<div className="text-xs text-red-400 mt-0.5">{peer.errorMessage}</div>
										)}
									</div>
									<div className="flex items-center gap-1 shrink-0">
										{peer.id !== LOCAL_PEER_ID && (
											<button
												type="button"
												onClick={() => handleVerify(peer)}
												disabled={verifyingId === peer.id}
												className="p-2 rounded hover:bg-th-surface-hover text-th-text-muted"
												title="疎通確認"
											>
												<RefreshCw className={`w-4 h-4 ${verifyingId === peer.id ? "animate-spin" : ""}`} />
											</button>
										)}
										<button
											type="button"
											onClick={() => setEditingId(peer.id)}
											className="p-2 rounded hover:bg-th-surface-hover text-th-text-muted"
											title="編集"
										>
											<Pencil className="w-4 h-4" />
										</button>
										{peer.id !== LOCAL_PEER_ID && (
											<button
												type="button"
												onClick={() => handleDelete(peer)}
												className="p-2 rounded hover:bg-red-900/30 text-red-400"
												title="削除"
											>
												<Trash2 className="w-4 h-4" />
											</button>
										)}
									</div>
								</div>
							)}
						</li>
					))}
				</ul>
			)}

			<p className="text-xs text-th-text-muted">
				※ 追加した peer は Hub から代理ログインしてトークンを保存します。<br />
				※ peer 側のサーバーは変更不要です。
			</p>
		</div>
	);
}
