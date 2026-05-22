# Changelog

All notable changes to this project will be documented in this file.

## [0.1.152] - 2026-05-22

### Fixed
- **リモート peer セッションでファイルブラウザが「Access denied」になる問題を修正**: FileViewer は常に Hub の `/api/files/*` を叩いていたため、pane が remote peer 上の Claude Code につながっているとき Hub から peer のファイルシステムが見えず 403 を返していた。新規 `/api/peers/:peerId/files/*` 汎用 proxy を追加して `list / read / raw / changes / git-changes / git-diff / language / download / upload / images` を peer の `/api/files` にストリーミング転送する (binary streaming を切らないよう `peerFetch` の 5s timeout は経由しない)。フロントは `useFileViewer(sessionWorkingDir, peerId?)` で URL prefix を切り替え、`DesktopLayout` / `App.tsx` (mobile path) どちらも `{ dir, peerId }` ペアで FileViewer を mount し直すよう揃えた。Mobile 経路では `apiSessions` からの peerId フォールバック lookup を追加して、reload 直後に `openSessions` がまだ peer session を含まない瞬間でも peer URL に解決できるようにした (`backend/src/routes/peers.ts`, `frontend/src/hooks/useFileViewer.ts`, `frontend/src/components/files/FileViewer.tsx`, `frontend/src/components/DesktopLayout.tsx`, `frontend/src/components/PaneContainer.tsx`, `frontend/src/App.tsx`)
- **DesktopLayout が propSessions と apiSessions をマージするときに peerId を落としていた問題を修正**: pane の sessionId が `apiSessions` だけに存在する状態 (= reload 直後で `openSessions` に未追加) で `sessions.find(...).peerId` が undefined になり、画像 upload / FileViewer の URL が Hub local に流れてしまっていた。マージ結果に `peerId: apiSession.peerId ?? propSession.peerId` を常に付ける (`frontend/src/components/DesktopLayout.tsx`)

## [0.1.151] - 2026-05-22

### Fixed
- **画像添付がリモート peer のセッションで動かなかった問題を修正**: 画像 upload は常に Hub の `/tmp/cchub-images/` に保存して、その path を tmux pane に送る作りだった。pane が remote peer 上の Claude Code につながっていると、peer 側からは Hub のディスクが見えないので「ファイルが見つかりません」になっていた。新規 `POST /api/peers/:peerId/upload/image` を追加してアクティブな pane が属する peer に multipart を proxy 転送し、peer 側の `/tmp/cchub-images/` に保存して peer-local な path を返すよう変更。フォーカス中の pane の peerId を `useSessions` → `OpenSession` → `Terminal` → `InputBar` の経路で伝搬し、`DesktopLayout` の paste / file pick、および mobile path (`TerminalPage`) の Terminal にも peerId を渡すよう揃えた (`backend/src/routes/peers.ts`, `backend/src/routes/upload.ts`, `frontend/src/utils/upload-image.ts`, `frontend/src/components/InputBar.tsx`, `frontend/src/components/Terminal.tsx`, `frontend/src/components/DesktopLayout.tsx`, `frontend/src/pages/TerminalPage.tsx`)

## [0.1.150] - 2026-05-22

### Added
- **ダッシュボードのマルチサーバー対応**: 登録された peer ごとに `ServerInfo` カードを並べて、各 peer の CPU / Memory / Disk / Swap / Load を独立にポーリング表示する。新規 hook `usePeerServerMetrics` が `/api/peers/:peerId/dashboard` を 30 秒間隔で叩く。Throughput はブラウザの WS バイト数を見ているので Local カードのみで表示し、remote カードでは抑制する (`frontend/src/components/dashboard/PeerServerCard.tsx`, `frontend/src/hooks/usePeerServerMetrics.ts`, `backend/src/routes/peers.ts`, `backend/src/routes/dashboard.ts`)

### Changed
- **接続端末数をユニーク化**: `connectedClients` バッジが従来は WebSocket 接続数 (= 同じブラウザの複数タブ・再接続も別カウント) を返していた。フロントが `localStorage` に永続 UUID を保存して mux WS の URL に `?deviceId=...` で送信し、backend は deviceId 単位でユニーク化した数を返すよう変更。1 端末から複数タブを開いても 1 カウント、別端末/別ブラウザは別カウントになる (`frontend/src/utils/device-id.ts`, `frontend/src/hooks/useMultiplexedTerminal.ts`, `backend/src/index.ts`, `backend/src/routes/terminal-mux.ts`)

## [0.1.149] - 2026-05-22

### Fixed
- **v0.1.148 で全 tmux session の indicator が常に `completed` のまま動かなくなった退化を修正**: 親遡上削除により `ccSessionId` が null になり、hook event の `session_id` と紐付けできなくなっていた。親遡上は復活させて hook 紐付け用の `ccSessionId` は取得し、漏洩防止のために recap 系 (`ccRecap` / `ccFirstPrompt` / `ccSummary`) は `ccSession.projectPath === currentPath` のときだけ表示するよう分離 (`backend/src/services/claude-code.ts`, `backend/src/routes/sessions.ts`)
- **`pathToProjectName` が `.` を `-` に置換していなかった問題を修正**: Claude Code 側は `/Users/m0a/repo/github.com/m0a/cc-hub` → `-Users-m0a-repo-github-com-m0a-cc-hub` のように `.` も `-` に変換するが、cchub の `pathToProjectName` は `/` のみ置換していたため、`.` を含む path (`github.com` 等) の project dir を見つけられず親遡上で祖先 (= `/Users/m0a`) のセッションを全 pane に共有してしまっていた。`/` と `.` の両方を置換するよう修正 (`backend/src/services/claude-code.ts`)

### Changed
- `cchub-send` Skill に複数行 paste の submit 挙動 (`--submit` フラグの末尾 CR2回でも paste mode を抜けないことがある) と、対処手順 (別 send で `\r` を追い打ち / 受信側 pane で `tmux send-keys Enter`) を追記 (`.claude/skills/cchub-send/SKILL.md`)

## [0.1.148] - 2026-05-22

### Fixed
- **複数の tmux セッションが同じ `ccSessionId` / `ccRecap` / `ccFirstPrompt` を共有してしまう問題を修正**: `getSessionForPath` / `getRecentSessionsForPath` は workingDir の project dir に jsonl が見つからないと `/` まで親ディレクトリへ遡って探す挙動だった。これが「Claude Code を `/Users/m0a` で起動 → `cd <subdir>` した tmux pane」では祖先 (= m0a) project の最新 jsonl を全 pane に返してしまい、別々の Claude Code セッションが同じ recap を表示する漏洩を起こしていた。親遡上を削除して exact path match のみに変更。jsonl が無い pane は `null` を返す (= 表示しない方が誤情報よりまし)。launchd / TZ skew のフォールバックは既存の `ptySessionId` / `tty-start-time` 経路でカバー済み (`backend/src/services/claude-code.ts`)

### Changed
- `cchub-send` Skill に「双方向対話のセットアップ」「peer の hook 設定を診断する (`/api/notify/hook-status`)」「`--submit` フラグの使い方」を追記。`Bash(cchub send:*)` の事前許可を必須ステップとして明文化 (`.claude/skills/cchub-send/SKILL.md`)

## [0.1.147] - 2026-05-22

### Fixed
- **新規 `claude` セッション (= `-r` フラグ無し) で `ccSessionId` が取れず indicator state の即時更新と通知が動かない問題を修正**: `buildSessionsList` の最終 path fallback (`ccSessionsByPath.get(currentPath)`) が `ptySessionId` 必須になっていたため、`claude -r <uuid>` ではない新規起動セッションでは hook event の `session_id` と紐付けるべき `ccSessionId` が常に `undefined` になり、`applyHookIndicatorUpdate` が peer 横断検索しても何にもヒットしないという経路ができていた。条件から `ptySessionId` 要件を外し、`getSessionByTtyStartTime` (TZ skew で失敗することがある) が null を返したら無条件で cwd 配下の最新 `.jsonl` にフォールバックするよう変更 (`backend/src/routes/sessions.ts`)

### Added
- **`cchub send --submit` フラグ**: 末尾に `\r\r` を追加して送信する。Claude Code の TUI は paste mode に入った入力を `\r` 1回では submit せず、明示的に2回の Enter を要求するため、`cchub send` から Claude Code に対話させるときは `--newline` ではなく `--submit` を使うのが確実 (`backend/src/commands/send.ts`, `backend/src/cli.ts`)

## [0.1.146] - 2026-05-22

### Added
- **`cchub send` CLI と `POST /api/sessions/:id/panes/input` エンドポイント**: ローカル / peer サーバの tmux パネルへ任意のバイト列を CLI から送り込めるようになった。`cchub send <peer>:<session>:<paneId> "text"` の形式で、`<peer>` は `local` / peer id / nickname のいずれかを許容。`--stdin` で stdin から payload を読み込み、`--newline` で末尾に CR を付与 (シェルや TUI に "Enter で確定" させる用途)、`--base64` でバイナリを送信できる。peer 認証がある場合は `peers.json` の `wsToken` を Bearer として自動で付ける (`backend/src/routes/sessions.ts`, `backend/src/commands/send.ts`, `backend/src/cli.ts`)
- `cchub-send` skill を追加。target 記法、フラグの使い分け、`paneId` の調べ方、よくあるエラーの解決手順をまとめてある (`.claude/skills/cchub-send/SKILL.md`)

## [0.1.145] - 2026-05-22

### Changed
- **「キャッシュクリア」を完全リセット仕様に強化**: 従来は Service Worker unregister と Cache API 削除のみで、IndexedDB / localStorage / sessionStorage が残り、`location.reload()` も memory cache を許容していたため、PWA がスタックしたバージョンに留まることがあった。`frontend/src/utils/nuke-cache.ts` (新規) に統一処理を切り出し、SW + Cache API + IndexedDB + localStorage + sessionStorage をすべて削除した上で `?_nocache=<timestamp>` 付きの cache-busted hard reload (`location.replace`) を行う。Dashboard の「キャッシュクリア」ボタンと `Ctrl/Cmd+Shift+F5` ショートカット両方で同じ処理を実行 (`frontend/src/components/dashboard/Dashboard.tsx`, `frontend/src/components/DesktopLayout.tsx`)
- 副作用: localStorage を消すため認証トークンも消える → 再ログインが必要になる

## [0.1.144] - 2026-05-22

### Fixed
- **他 peer の indicator state / OS 通知が動かない問題を修正**: 従来は peer の `hook-event` (Stop / PreToolUse / UserPromptSubmit / PostToolUse) が「ターミナルでアクティブに表示している peer」の sharedWs 経由でしか届かず、他 peer は通知も indicator 即時更新も受け取れなかった。`usePeerSessionsWatcher` が各 peer 用 WS で hook-event を受け、`applyHookIndicatorUpdate` (全 peer 横断検索) で indicator を即時反映 + `fireHookNotification` で OS 通知を発火するように変更 (`frontend/src/hooks/usePeerSessionsWatcher.ts`)
- 副次: `applyHookIndicatorUpdate` を Hub local 限定から全 peer 横断検索 (ccSessionId UUID) に変更

## [0.1.143] - 2026-05-22

### Fixed
- **peer sessions watcher の WS が backend zombie 検知で 60 秒ごとに切断され、retry ループに陥っていた問題を修正**: v0.1.140 で導入した watcher が ping を送っていなかったため、Hub の `terminal-mux` (`PING_TIMEOUT_MS=60s`) で zombie 判定され `close → 5s 後 retry → close` のサイクルに入っていた。Linux Hub 側に対しても Mac peer 側に対しても同様に発生し、その副作用で peer のターミナル表示が停止する症状が出ていた。watcher に 25 秒間隔の ping を追加 (`frontend/src/hooks/usePeerSessionsWatcher.ts`)

## [0.1.142] - 2026-05-22

### Added
- **peer 横断のセッション並び替え**: Hub 側に `${peerId}:${sessionId}` 形式の merged order を保存する `/api/peers/session-order` (GET/PUT) を新設し、ドラッグ&ドロップで Hub と remote peer のセッションを混在して並び替え可能にした。並び順は端末間で共有される (`backend/src/services/peer-registry.ts`, `backend/src/routes/peers.ts`, `frontend/src/hooks/useSessions.ts`, `frontend/src/components/SessionList.tsx`)

### Fixed
- 並び替え時に `useSortable` / `SortableContext` の id が `session.id` のみだったため、Hub と peer で同名 tmux セッション (e.g. `cchub-work-1`) があると衝突して並び替えが破綻していた問題を修正。composite key (`${peerId}:${sessionId}`) で一意化

## [0.1.141] - 2026-05-22

### Fixed
- **Hub local セッションが peer 接続中に消える問題を完全解消**: v0.1.140 で peer のセッション一覧を WS push に統一したが、Hub local 自身は引き続き `useMultiplexedTerminal` の sharedWs (アクティブセッションの peer に追従する) 経由でしか受信できておらず、Mac peer のセッションを開いた状態のままだと Hub の sessions-updated が来ず Linux 側の一覧が空になっていた。`usePeerSessionsWatcher` を Hub local も対象にして全 peer (local 含む) に独立 WS を張る設計に変更。`useMultiplexedTerminal` 側の sessions-updated dispatch は重複防止で撤去 (`frontend/src/hooks/usePeerSessionsWatcher.ts`, `frontend/src/hooks/useSessions.ts`, `frontend/src/hooks/useMultiplexedTerminal.ts`)
- 副次: `cachedSessions` / `cachedRemotePeerSessions` の二系統 cache を watcher の sessionsByPeer 一系統に統合し、`mergedSessions` / `updateSessions` を撤去して useSessions のコードを簡素化

## [0.1.140] - 2026-05-22

### Changed
- **peer セッション取得を polling → WS push に統一**: 5秒間隔の `GET /api/peers/sessions` を撤廃し、各 remote peer の `/ws/mux` に常時接続して `sessions-updated` push を直接購読するよう変更。PWA を peer セッションのまま再オープンした場合に Hub の sessions-updated が一度も届かず Linux 側のセッションが画面から消える問題も同時に解消する。WS 接続は peer 単位で永続化されるので peer 切替で leak しない (`frontend/src/hooks/usePeerSessionsWatcher.ts` 新規, `frontend/src/hooks/useSessions.ts`)
- **peer WS URL ヘルパー共通化**: `peerHttpUrlToWsUrl` / `appendWsToken` を `frontend/src/services/peer-ws.ts` に切り出し、`useMultiplexedTerminal` / `usePeerConnection` / `usePeerSessionsWatcher` の3箇所のインライン正規表現を統一 (`frontend/src/services/peer-ws.ts` 新規)
- watcher の再接続を exponential backoff (5s→60s cap) に変更。永続的にオフラインな peer への connect loop を抑制

## [0.1.139] - 2026-05-22

### Fixed
- **macOS launchd 経由起動時に pane_title の非ASCII文字が `_` に化ける**: Mac で `cchub` を launchd で起動した場合、子プロセスに `LANG`/`LC_ALL` が継承されないため tmux が ASCII fallback モードで動き、Claude Code のスピナー `⠐` (U+2810) などの非ASCII文字を `_` に置換していた。結果として peer 経由で Linux Hub に届く paneTitle が `_ <topic>` の形式になり、UI 上で `_` プレフィックスとして表示されていた。`backend/src/services/tmux.ts` 内の全 `Bun.spawn` 呼び出しに `env: TMUX_ENV` (LANG/LC_ALL を UTF-8 で固定) を渡すよう修正。launchd 経由でも UTF-8 出力が保証されるようになった (`backend/src/services/tmux.ts`)
- 関連: SessionList / App / PaneContainer / FileBrowser / FileViewer / hookNotification の paneTitle 加工正規表現を `[✳★●◆✻✽⏳⠀-⣿]\s*` に統一。Claude/Codex のスピナーアニメーション全フレーム (U+2800–U+28FF) を除去できるようにした (`frontend/src/App.tsx`, `frontend/src/components/PaneContainer.tsx`, `frontend/src/components/SessionList.tsx`, `frontend/src/components/files/FileBrowser.tsx`, `frontend/src/components/files/FileViewer.tsx`, `frontend/src/utils/hookNotification.ts`)
- 関連: ホームディレクトリ短縮の正規表現を `/(?:home|Users)/<user>` 対応に拡張し、共通ユーティリティ `frontend/src/utils/path.ts` (`toHomeShortPath` / `stripHomeProjectPrefix`) に集約。macOS の `/Users/<user>` パスもチルダ省略されるようになり、`SessionList` / `PaneContainer` / `FileBrowser` / `FileViewer` / `hookNotification` の 7 箇所のインライン regex を1関数経由に統一 (`frontend/src/utils/path.ts` 新規)

## [0.1.138] - 2026-05-21

### Fixed
- **Lost セッション再開時の peer ルーティング**: `SessionList.handleResume` がローカル Hub の `/api/sessions/history/resume` を `authFetch` で直接叩いており、`session.peerId` を無視していた。これにより remote peer (例: Mac) 上のロストセッションを再開しようとすると Hub (例: Linux) 側で `cd '/Users/m0a' && claude -r ...` を実行しようとして `cd: no such file or directory` で失敗していた。`sessionFetch(session, peers, …)` 経由に切り替え、所属 peer の URL に直接 POST されるよう修正。conversationId なし時の `createSession` 経路にも `session.peerId` を引き継ぐようにした。あわせてアクティブセッションの `POST /:id/resume` も peer-aware に統一 (`frontend/src/components/SessionList.tsx`)
- `SessionListProps.onSelectSession` / `onSelectPane` の引数型を `SessionResponse` → `ExtendedSessionResponse` に拡張。resume 後のナビゲートで `peerId` を伝搬できるようにし、後続の WebSocket subscribe が正しい peer に向くようにした (`frontend/src/components/SessionList.tsx`)

## [0.1.137] - 2026-05-21

### Added
- **peer に対するセッション作成**: 新規セッションダイアログに「サーバー」セレクターを追加し、Hub だけでなく登録済み peer 上にも新しいセッションを作れるようにした。さらに peer 選択時はその peer の filesystem を Hub のディレクトリピッカーと同じ UI で browse できる ─ `~/Users/m0a` などをタップで掘っていける (`frontend/src/components/SessionList.tsx`, `frontend/src/hooks/useSessions.ts`, `backend/src/routes/peers.ts`)
- **履歴一覧のマルチサーバー対応**: 「履歴」タブで全 peer のプロジェクトをマージ表示し、各プロジェクト・各セッションに peer ニックネームバッジと色付き左ボーダーを付ける。プロジェクト展開、会話履歴の表示、再開ボタンすべてが該当 peer の API に振り分けられるようになった。検索 (SSE) は当面 Hub 限定 (`backend/src/routes/peers.ts`, `frontend/src/hooks/useSessionHistory.ts`, `frontend/src/components/SessionHistory.tsx`)
- **`usePeers` の定期 polling**: 5秒間隔で `/api/peers` を再取得することで、verify の一時的失敗で `offline` 表示のまま固定されていた peer がオンライン復帰時に自動で再選択可能になる (`frontend/src/hooks/usePeers.ts`)

### Fixed
- `POST /api/peers/history/:peerId/resume` が peer 側の status code を 200/502 に潰していて、`duplicate_working_dir` (409) のような特別ハンドリングが効かなくなっていたのを修正。peer のステータスをそのまま透過する (`backend/src/routes/peers.ts`)

### Notes
- File viewer / conversation viewer / session resume は引き続き peer 対応の余地あり (Phase 4 候補)
- peer 横断 search も Hub のみ。SSE のストリーミング merge は今後の課題

## [0.1.136] - 2026-05-21

### Added
- **マルチサーバー対応 (Phase 1 + 2)**: Hub に登録した複数の cchub インスタンス (peer) のセッションを 1 画面でマージ表示し、選択するとターミナル WebSocket がその peer に直接切り替わる。ブラウザは Hub URL を1つ知っていれば全マシン操作できる。
  - Hub に peer レジストリ (`~/.cc-hub/peers.json`, mode 0600) を追加し、`GET/POST/PATCH/DELETE /api/peers` および集約 `GET /api/peers/sessions` を提供 (`backend/src/services/peer-registry.ts`, `backend/src/services/peer-auth.ts`, `backend/src/routes/peers.ts`)
  - Servers タブを Dashboard パネルに追加し、デスクトップ・モバイル両方から peer の追加 / ニックネーム / 識別色 / 削除を操作可能に (`frontend/src/components/PeerManager.tsx`, `frontend/src/components/DashboardPanel.tsx`, `frontend/src/App.tsx`)
  - セッションカードに peer ニックネームバッジと色付き左ボーダーを表示 (`frontend/src/components/SessionList.tsx`)
  - `useMultiplexedTerminal` に `peerWsBase` を渡せるよう refactor、選択中セッションの peer に応じて WS 接続先を切替 (`frontend/src/hooks/useMultiplexedTerminal.ts`, `frontend/src/hooks/usePeerConnection.ts`, `frontend/src/pages/TerminalPage.tsx`, `frontend/src/components/DesktopLayout.tsx`)
- **peer 自動検出**: Servers タブの「🔍 検索」ボタンで Tailscale tailnet 内の cchub インスタンスを発見。クリックで peer 追加フォームに pre-fill。実行前に必ず確認ダイアログを出すため、社内ネットワーク等でスキャンしてしまう事故を防ぐ (`backend/src/services/peer-discovery.ts`)
- **パスワード無効な peer の追加**: peer 側で `cchub` を `-P` なしで起動していても追加できるよう、`/api/auth/required` で事前判定する (`backend/src/services/peer-auth.ts`)

### Fixed
- `fetchAndOpenSession` の useEffect 依存に毎レンダー再生成される `createInitialSession` が含まれていたため、効果が無限に再実行され `activeSessionId` を localStorage の値に巻き戻していた。`useCallback` で安定化し、`t` は ref 経由で参照することで peer セッションが「開いてすぐ Hub セッションに戻る」現象を解消 (`frontend/src/App.tsx`)
- peer 接続中にその peer から届く `sessions-updated` push が Hub のマージ済み一覧を上書きし、`peerId` を `local` に書き換えて WS 接続先がフリップしていた。Hub 接続中のみ受信するようガード追加 (`frontend/src/hooks/useMultiplexedTerminal.ts`)
- モバイル (TerminalPage) は `peerWsBase` を `useMultiplexedTerminal` に渡していなかったため、スマホからは peer セッションのターミナルが開けなかった。desktop と同じ配線に統一 (`frontend/src/pages/TerminalPage.tsx`)
- peer セッションのテーマ / タイトル変更 / 削除が Hub 固定で 404 になっていたのを、`sessionFetch(session, peers, path, init)` ヘルパー経由で peer の URL + トークンに振り分けるよう修正 (`frontend/src/services/peer-fetch.ts`, `frontend/src/hooks/useSessions.ts`, `frontend/src/components/SessionList.tsx`)

### Notes
- File viewer / conversation viewer / session resume / session order などの REST 系は引き続き Hub 固定 (peer の対象に飛ばさない)。Phase 3 で対応予定
- peer 追加 / 削除は Hub にログインしているクライアントなら誰でも実行可能 (家庭内利用前提)

## [0.1.135] - 2026-05-20

### Changed
- **セッション削除を「kill のみ・一覧から消さない」挙動に変更**: アクティブセッションを削除しても tmux は kill するが `last-known-sessions.json` のエントリは残し、一覧には Lost として表示され続けるようにした。これにより削除後も「再開」ボタンで会話の続きをワンタップで開ける。完全に一覧から消したい場合は Lost セッションをもう一度削除すると last-known からも除外される (`backend/src/routes/sessions.ts`)
- 削除確認ダイアログの警告文を実挙動に合わせて更新 (「この操作は取り消せません」→「tmuxセッションを終了します。一覧には Lost として残り、「再開」ボタンで会話を続けられます。」)、トーンを警告赤から中立色に変更 (`frontend/src/App.tsx`, `frontend/src/components/SessionList.tsx`, `frontend/src/i18n/locales/{ja,en}.json`)

## [0.1.134] - 2026-05-20

### Fixed
- ターミナルでマウスホイール/トラックパッドのスクロールが効かず、代わりに Claude / Codex の入力履歴が切り替わる問題を修正
  - 原因: xterm.js は active mouse protocol が WHEEL を含むとき、wheel イベントを直接アプリ (Ink TUI) に転送し、TUI 側で↑/↓キー扱いとなっていた
  - 対応: `Terminal.tsx` の wheel listener を capture 段階に移し `stopPropagation()` を追加。xterm.js のハンドラに届かないようにして、`scrollTerminal()` だけが走るようにした

## [0.1.133] - 2026-05-20

### Added
- `cchub update` で GitHub トークン認証をサポートし、未認証 60/時のレート制限 (60/hr) を 5000/時 に引き上げ可能に
  - 検出順: `GITHUB_TOKEN` env → `GH_TOKEN` env → `gh auth token` サブプロセス自動検出
  - 認証時は `🔑 Using GitHub token from {{source}}` を表示
  - 403 + `x-ratelimit-remaining: 0` を rate limit として識別し、リセット時刻と認証手順 (`export GITHUB_TOKEN=<token>` / `gh auth login`) を表示
  - 未設定時は従来通り未認証で動作 (`backend/src/commands/update.ts`, `backend/src/i18n/index.ts`)

## [0.1.132] - 2026-05-20

### Added
- **履歴タブの Codex 対応**: `~/.codex/sessions/**` の rollout JSONL を読み取り、Claude セッションと同じ project バケットに merge して表示する `CodexHistoryService` を追加。各履歴行に `Claude` / `Codex` バッジを表示、再開時は agent に応じて `claude -r` / `codex resume` を自動切り替え。検索 (SSE ストリーミング含む)・会話表示・プロジェクト一覧の全エンドポイントで Codex セッションを統合 (`backend/src/services/codex-history.ts`, `backend/src/routes/sessions.ts`, `frontend/src/components/SessionHistory.tsx`, `frontend/src/hooks/useSessionHistory.ts`, `shared/types.ts`)

## [0.1.131] - 2026-05-19

### Changed
- **ConversationViewer の可読性向上**: Tool 結果を再びデフォルトで展開状態に (1行サマリだけだと結果が見づらかった)。折りたたみ内部の本文色を `zinc-500` / `th-text-secondary` から `zinc-300` / `zinc-200` に引き上げ、ダーク背景でのコントラストを改善 (`frontend/src/components/ConversationViewer.tsx`)

## [0.1.130] - 2026-05-19

### Changed
- **ConversationViewer の見た目を再設計**: ターミナル風のコンパクトレイアウトに変更。各ターンに role 色のサイドバー (2px) + 役割ラベル (uppercase, dim) + 本文を indent、Claude は violet / Codex は cyan / User は blue / System は gray / Summary は amber で識別。Tool 呼び出し・結果・Thinking はデフォルトで畳むようにし、1行サマリで全体を俯瞰しやすく (`frontend/src/components/ConversationViewer.tsx`)

## [0.1.129] - 2026-05-19

### Fixed
- **ConversationViewer の追従スクロール**: ストリーミング中にメッセージが追加されるたび最下部に強制スクロールしてしまい、上にスクロールして読んでいるとその場に留まれなかった問題を修正。ターミナルと同じ挙動 (最下部にいるときだけ追従、上にスクロール中は留まる、最下部に戻すと追従再開) に変更。`atBottomRef` を常時更新するよう内部状態追跡と外部コールバック (キーボード制御) を分離し、auto-scroll を `atBottomRef` でゲート (`frontend/src/components/ConversationViewer.tsx`)

## [0.1.128] - 2026-05-19

### Fixed
- **lost セッションの再開**: 再起動後に lost 状態で復元されたセッションで、`last-known-sessions.json` のスナップショットを毎回上書きする際 `currentPath` などが一時的に取れなかったタイミングで既存値ごと消えてしまい、フロントの再開フローが履歴 API ではなくアクティブ用エンドポイントに落ちて 404 になる事象を修正。新しい値が無いときだけ前回値を維持する fallback を追加 (`backend/src/routes/sessions.ts`)

## [0.1.127] - 2026-05-19

### Added
- **`cchub debug` CLI**: 本番 systemd user service の Bun inspector モードを必要な時だけ on/off できる仕組み。`BUN_OPTIONS` 環境変数を systemd drop-in (`~/.config/systemd/user/cchub.service.d/99-inspect.conf`) として書き出して `daemon-reload` + `restart`、終わったら drop-in を消して通常モードに戻す
  - `cchub debug enable` — `0.0.0.0:9229` で Bun inspector を開く
  - `cchub debug disable` — inspector を閉じて通常モードへ
  - `cchub debug profile [--seconds N]` — N 秒だけ inspector を開いて自動で disable (デフォルト 30s)
  - `cchub debug status` — 現在の inspector 状態を表示
  - **アイドル時オーバーヘッドゼロ**: 通常モードでは inspector port は開かない。本番で慢性的なフットプリントを増やさずに、必要な時だけ Chrome DevTools (`chrome://inspect`) から JS 関数名・行番号付きで CPU profile / heap snapshot を取得可能
  - Linux systemd user 限定 (macOS launchd は未対応)

## [0.1.126] - 2026-05-19

### Added
- **スクロール体験の刷新**: server-side scrollback でスクロール時にサーバ応答待ちで画面が止まる問題を解消
  - `viewport-pseudo.ts` 新設。`makePseudoViewport(viewport, delta)` で現フレームを delta 行ぶんずらし露出側を空行で埋めた疑似 viewport を生成。`scrollBy` / `scrollToLive` のキャッシュミス時にこの疑似フレームを即時描画し、サーバから本物が届いたら上書き。応答待ち中でも画面が実際にずれて動く
  - クライアント側 viewport キャッシュ (`Map<offset, {viewport, historySize}>`、pane あたり LRU 20件)。同じ offset への往復スクロールはサーバラウンドトリップなしで即時描画。`historySize` を一緒に保存し、tmux 出力で履歴が変わった場合は自動で stale 扱い。`layout-change` で全キャッシュ破棄
  - 右上のスクロール位置インジケータを `{ text, loading }` に拡張。応答待ち中は青色の `[N/M] ⏳`、本物着弾で黄色の `[N/M]` に切替＋3秒フェード。今どのくらいスクロール中で、サーバが追いついているかが視認できる

### Fixed
- 連続 wheel / touch スクロールで `scrollBy` が秒間 50回以上発火し、毎回 viewport 再取得＋全画面 VT 再描画が走って小刻みな揺れに見えていた問題を rAF coalesce で解消 (フレームに 1 回だけ scrollBy を flush)
- 高速スクロール中に in-flight な複数の `request-viewport` 応答が前後して届いて画面が一瞬戻る現象に対し、`onPaneViewport` で現在の期待 offset と応答 offset を照合して不一致なら repaint をスキップする stale guard を追加 (キャッシュには保存)

## [0.1.125] - 2026-05-19

### Fixed
- **慢性的な CPU 高負荷 (平均 73〜108%) を解消**: `sessions-push` のホットループで毎周期に全 jsonl の readdir + stat + 内容読み込みが走り、加えて UI セッション切替のたびに `tmux -CC attach` を再 spawn していた問題を修正。平均 CPU を **77.6% → 23.4% (約70%削減)** に低下 (10分間観測)
  - `tmux-control.ts`: `GRACE_PERIOD_MS` を 5s → 30s に戻す。idle CPU 削減目的で短縮されていたが、結果として UI 切替のたびに `tmux -CC attach` を再 spawn して逆に負荷を増やしていた
  - `claude-code.ts`: `SESSION_DATA_CACHE_TTL` を 5s → 30s。`sessions-push` 周期 (5s) と同位相で毎回 cache miss していた問題を解消。mtime チェックは内側に残るのでフレッシュさは維持
  - `claude-code.ts`: `pathResultCache` (TTL 3s) を追加し、`getSessionForPath` / `getRecentSessionsForPath` / `getSessionByTtyStartTime` の readdir + 全 jsonl stat スイープを同一 `sessions-push` tick 内でショートサーキット

## [0.1.124] - 2026-05-18

### Fixed
- **EVEN G2 Glasses 統合の復旧**: v0.1.121 のプロトコル切替 (server-side scrollback) に追従できておらず、glasses クライアントが旧 `request-content` / `initial-content` / バイナリ `0x02` フレームに依存していた問題を修正
  - WebSocket メッセージを `request-viewport` / `viewport` に置き換え、`viewport.lines` (ANSI 付き行配列) から `stripAnsi` してバッファ更新
  - 不要になったバイナリフレームハンドラ・`resize 120x20` 送信を撤去 (resize はメイン UI 側のクライアントサイズを上書きしてしまうため、観測専用クライアントとしては正しい挙動)
  - `requestContentAndWait` は新プロトコルでも引き続き機能 (buffer 差分で待機)

## [0.1.123] - 2026-05-18

### Added
- **Server-side scrollback (再導入)**: tmux を visible region とスクロールバックの単一情報源とし、xterm.js は描画専用にする構成へ。v0.1.121 で発生したモバイル描画 regression を解消した上で再投入
  - WebSocket `request-viewport` / `viewport` プロトコル: クライアントが offset を指定して任意の窓を要求、サーバは tmux `capture-pane -S/-E` で該当行を返す
  - `pane-viewport.ts` に offset ベースの window 取得を集約。altScreen TUI (htop/vim/Codex) は触らず、normal-screen の inline TUI / シェルに対してだけ scrollback で padFill して "void" を消す
  - subscribe 直後に初期 viewport を即配信し、モバイルでの「灰色キャンバス」レースを排除
  - 慣性スクロールは scroll 量を offset に換算して tmux に問い合わせる方式に置き換え (xterm 側 scrollback は 0)
  - ターミナルタップ / ソフトキーボード表示で offset=0 (live edge) に強制復帰

### Fixed
- Void エリア対策の総合修正
  - Claude TUI のように pane 全域を塗らないアプリで残る末尾空白を、上の scrollback で穴埋めして常にフル pane 分の内容を見せる
  - スクロール中も同じ padFill を適用 (capture window が visible region をまたいでも void が広がらない)
  - シェルがプロンプトを空白行に置いている場合は、カーソル行を含めて trim を止め、padFill のシフト分だけ cursor を下に追従させる (cursor が padded-in な scrollback 上に乗らない)
- モバイルで `client-size` が 1 行単位で揺れて viewport が再送される現象を抑制 (`±1` 行は noise として吸収)

### Changed
- `state-snapshot` / `state-diff` ベースのフレーム配信を撤廃し、`viewport` 配信に統一 (実コード -481 行)
- フロントエンドの xterm scrollback を 0 に固定 (履歴の管理は tmux 側のみ)

## [0.1.122] - 2026-05-18

### Reverted
- v0.1.121 (server-side scrollback) を完全に revert。モバイル端末で xterm.js キャンバスがグレーになりターミナルが描画されない深刻な regression があったため
  - 機能内容としては v0.1.120 と完全に同等 (revert コミット 2 本のみ)
  - v0.1.121 の GitHub Release と tag は削除済み。`cchub update` は v0.1.122 を最新として取得する
  - server-side scrollback 自体は後日、モバイル側の挙動を含めて再検討する

## [0.1.120] - 2026-05-18

### Added
- ダッシュボードに UI 拡大率設定を追加 (80% / 90% / 100% / 115% / 130%)
  - `<html>` の `font-size` を経由して Tailwind の rem ベース要素 (Dashboard / SessionList / FileViewer / アイコン) を一括スケール
  - xterm.js は独自フォント設定のためターミナル本文には影響せず、Terminal の Cmd+= / Cmd+- とは独立して制御可能
  - 設定は `localStorage['cchub-ui-scale']` に永続化、FOUC を防ぐため `main.tsx` で early apply

### Fixed
- Welcome セッション作成時に `cd '~' && claude` が `cd: no such file or directory: ~` で失敗していた問題を修正
  - `agentStartCommand` / resume command で `shellQuote` 前に `~` / `~/...` を `homedir()` に展開する `expandHome()` ヘルパーを追加

## [0.1.119] - 2026-05-18

### Fixed
- ターミナルが出力中にスクロールできない問題を修正 (#166)
  - state-snapshot 適用後に毎回無条件で `term.scrollToBottom()` していたため、5/sec の snapshot 流入下でユーザーのスクロールアップが 200ms 以内に引き戻されていた
  - 適用前に `viewportY >= baseY` (= 末尾固定) かどうかを判定し、末尾固定時のみ自動スクロール

### Changed
- `cchub notify` hook 受信時の CPU を大幅削減 (#166)
  - `generateSmartMessage` がアクティブな Claude transcript (数 MB) を毎回 `readFile` + `split('\n')` していたのを、`Bun.file().slice()` で末尾 256 KB のみ読む方式に変更
  - Hono request logger が `POST /api/notify` をスキップするように (既存の `/api/sessions` スキップと同様)
  - cpu-prof 計測: `stringSplitFast` 17.1% + logger 5.1% が消失 → 想定 CPU 削減 ~20%

## [0.1.118] - 2026-05-18

### Changed
- state-snapshot の per-pane emit cap を 100ms (10/sec) → 200ms (5/sec) に変更 (#164)
  - v0.1.117 でも cchub CPU が ~127% 残存していたため、レート制限を倍に強化
  - 初回 (idle 後) snapshot は 50ms debounce のままなのでタイピングレイテンシは不変
  - 連続再描画 (スピナー / log tail) のみ 5fps に頭打ち

## [0.1.117] - 2026-05-18

### Fixed
- state-snapshot 送信が pane あたり最大 ~20/sec で連続発火し cchub が CPU 150% 以上を消費する問題を修正 (#162)
  - `SNAPSHOT_MIN_INTERVAL_MS=100` の hard rate-limit を導入し、連続 `%output` 下でも 1 pane あたり最大 ~10/sec に制限
  - 初回 (idle 後) snapshot は従来通り 50ms debounce 後に送信されるためタイピングレイテンシは維持
- `[mux] state-snapshot ...` の詳細ログを `DEBUG_MUX=1` 配下に隔離し、journald への書き込み量を削減

## [0.1.116] - 2026-05-18

### Fixed
- Codex hook イベントが CC Hub のセッション / pane indicator に反映されない問題を修正 (#160)
  - Codex の `agentSessionId` を hook override のキーとして扱い、`PreToolUse` / `Stop` などの状態を session と pane に反映
  - `~/.codex/config.toml` / `~/.codex/hooks.json` の `cchub notify` 設定検出に対応
  - Codex hook 設定はホームディレクトリ側を使い、repo-local な Codex 専用コピーを持たない方針を明文化

## [0.1.115] - 2026-05-17

### Added
- デスクトップの選択モード（マウス長押しで起動）に Enter / Esc キーバインドを追加
  - Enter: 選択範囲を OS クリップボードにコピー＋モード終了
  - Esc: コピーせずモード終了

## [0.1.114] - 2026-05-17

### Changed
- デスクトップのセッションモーダル (Ctrl+B) とダッシュボードパネル (Ctrl+Shift+B) を 1.25 倍に拡大し、Mac などの高 DPI モニタでも読みやすく
  - タブレットには影響なし (`isTablet` 時は zoom 適用なし)

## [0.1.113] - 2026-05-17

### Fixed
- WebSocket が `CONNECTING` のまま長時間固まり「WebSocket connection error」+「Connecting...」表示で操作不能になる問題を修正
  - 10秒の接続 watchdog を追加し、`onopen` が発火しなければ強制クローズして既存の再接続経路を起動
  - `pong` の応答が25秒以上途絶えた OPEN ソケットを silently dead とみなし強制クローズ
  - `window` の `online` イベントで stale な socket を強制クローズしてから即時再接続
  - タブ復帰時 (`visibilitychange`) に `CONNECTING` が3秒超なら即座に強制クローズして再試行

### Changed
- サーバ側 WebSocket の `idleTimeout` を 120 秒から 60 秒に短縮し、死亡セッションの掃除を倍速化

## [0.1.112] - 2026-05-17

### Fixed
- ターミナル state-sync が連続出力中に止まって見える問題を修正 (#154)
  - `%output` トリガの snapshot scheduling を debounce から throttle に変更し、Codex のストリーミング出力や秒表示のように出力が途切れないケースでも定期的に反映
  - xterm.js の diff 適用ずれを避けるため、可視変更は full `state-snapshot` として配信
  - full snapshot 適用後に viewport を下端へ戻し、buffer は更新済みなのに古いスクロール位置を見続ける状態を防止
  - `capture-pane -a` は使わず、`capture-pane -e -p` で現在見えている TUI 画面を取得する方針を明文化

### Docs
- Codex / 他エージェント向けの `AGENTS.md` を追加し、`CLAUDE.md` と `.claude/skills` / `.claude/commands` を single source として参照する方針に統一 (#154)

## [0.1.111] - 2026-05-17

### Fixed
- Claude TUI が pane の下半分を描画しないことによる「黒い void」 を解消 (#152)
  - server が短い snap.lines を直前の scrollback で先頭埋め (prepend) して visible 全体を情報で満たす
  - `PadFillCache` を historySize 単位でキャッシュし、 毎 tick の追加 tmux round-trip を回避
  - 末尾 blank trim を `isVisuallyBlank` で統一 (ANSI escape のみの行も対象)

### Changed
- state-sync renderer を大幅 simplify (#152)
  - `bottomAlignOffset` / diff offset / auto-scroll fallback / EXTRA pane inflation を撤回
  - snap render は top-aligned で全行書き込み (snap canonical)
  - Channel C dump は `applied.baseY` から `snap.rows` 行を素直に読み出し
  - 差分: `+115 / -236` の縮減

### Docs
- アーキテクチャドキュメント (architecture.json / .html) を state-sync 化 + scrollback prepend pad に追従 (#151)

## [0.1.110] - 2026-05-17

### Changed
- ターミナル転送方式を byte-stream から tmux canonical state sync に置換 (#149, #147 Phase 2)
  - `tmux capture-pane -e -p` の出力を canonical state として扱い、snapshot/diff 形式で client に配信
  - scrollback delta を snapshot に同梱し、 client 側でも履歴をスクロールできるよう拡張
  - Channel C (drift detection) を新方式に対応 (state-sync 適用後の grid と canonical を比較)

### Fixed
- Claude TUI で画面下半分が「黒い void」 として固定表示される問題に暫定対応
  - server: `capture-pane` が trim する trailing blank 行に空文字 padding しない。 ANSI strip 後に空白のみの行も trim 対象に拡張
  - client: snapshot.lines を xterm grid の下端揃えで描画 (上端の余白は scrollback / 前 frame が見える)
  - 全て TEMPORARY マーク付き — Claude TUI が pane を画面下まで使う設計に変わったら削除可能
- モバイルでアクセスしたときに pane が desktop サイズのまま固定される問題を修正
  - `refresh-client -C` だけでは `window-size manual` の session で pane が resize されないため、 `resize-window` をペアで発行
  - 両 tmux コマンドを `Promise.all` で並列化し resize latency を半減

## [0.1.109] - 2026-05-16

### Added
- Channel C: クライアント xterm.js と tmux 内部状態の drift 検知機構 (dev-only、#147 Phase 1)
  - `CCHUB_SELF_VERIFY=1` でサーバ起動時に有効化
  - クライアントが trigger (`resize-done` / `reconnect-done` / `output-idle` / `periodic`) で xterm の可視範囲を server に送信
  - サーバが `tmux capture-pane -p` と比較し、差分を `/tmp/cchub-drift.log` に JSON Lines 形式で追記
  - production 環境では完全 no-op、ユーザに影響なし
  - 後続の state diff sync (#147 Phase 2-) の正しさ検証 oracle として継続利用

## [0.1.108] - 2026-05-16

### Fixed
- ファイルビューでファイルを開く / 切替時にファイル一覧のスクロール位置がリセットされる問題を修正
  - 原因1: `useFileViewer` の `isLoading` フラグが `listDirectory` と `readFile` で共有されており、ファイルを開くと FileBrowser が「読み込み中…」プレースホルダーで置き換わってアンマウントされていた
  - 原因2: モバイル単一ペインレイアウトでは `viewMode` が `'file'` に切り替わると FileBrowser 自体がアンマウントされていた
  - 修正: 初回ディレクトリ読み込み時のみプレースホルダー表示、`viewMode` 切替時は display 切替で FileBrowser を常駐させスクロール位置を保持
- ファイルビューで現在開いているファイルが視覚的に分かるよう、選択中ファイルを青背景＋青ボーダーでハイライト
  - popstate ハンドラーがブラウザビューに戻る際に `selectedFile` を明示的にクリアしていたため、戻ったタイミングでハイライトが消えていた問題も併せて修正

### Added
- ファイルビュー回帰テスト (`frontend/tests/e2e/file-viewer-selection.spec.ts`): desktop split layout でのスクロール保持＋選択ハイライト、mobile での browser↔file 往復スクロール保持

## [0.1.107] - 2026-05-15

### Fixed
- セッション一覧から別セッションを選んだ際 (`handleSelectSession`) や、ペインを直接選んだ際 (`handleSelectPane`) にも会話ビューで「会話を表示できません」が出る問題を修正
  - v0.1.106 では `fetchAndOpenSession` の3箇所のみ修正していたが、`OpenSession` を組み立てる経路は他にも `handleSelectSession` / `handleSelectPane` / `createInitialSession` の合計6箇所あり、その3箇所で `agent` / `agentSessionId` が欠落していた
  - 全ての構築箇所を `apiToOpenSession()` ヘルパーに集約。今後 `OpenSession` にフィールドを追加する際の取りこぼしを防止

### Changed
- `App.tsx` の `fetchAndOpenSession()` 内のネストされた if/else 階層を早期 return でフラット化、重複していた "create initial session" else ブロックを統一（130行→66行に圧縮）

## [0.1.106] - 2026-05-11

### Fixed
- スマホで会話ビューを開いた際に「会話を表示できません / セッションのエージェント情報が取得できませんでした」が表示される問題を修正
  - `App.tsx` の `fetchAndOpenSession()` 内 3 箇所で `OpenSession` を組み立てる際に `agent` と `agentSessionId` フィールドが欠落していた
  - API は `agent: 'claude'` を返していたが、フロントが受け取った値を捨てていたため `activeSession.agent` が undefined となり ChatView が `missing-agent` エラーを表示
  - WebSocket が不安定な環境では後追い同期パス（mobile `setOpenSessions` effect）も働かず、エラーが固定化していた

## [0.1.105] - 2026-05-09

### Added
- ターミナル遅延の end-to-end 計測用 instrumentation を追加（ssh+termux との比較用、本番動作には影響なし）
  - `CCHUB_BENCH=1` で起動するとバックエンドが WebSocket 送信ごとにフレームサイズ・送信所要時間・タイムスタンプをログ出力
  - フロントエンドに `window.__cchub_bench` を公開: `start()` で計測開始、受信フレーム数・xterm.js parse 時間 (P50/P95/Max)・スループットを記録
  - 受信ストリームに `__BENCH_END__` マーカーが現れると自動で集計レポートを `console.table` 出力
  - `scripts/prepare-bench-data.sh` で 4 種類のベンチ用データ (`/tmp/bench-{plain,color,jp,redraw}.txt`) を生成

## [0.1.104] - 2026-05-09

### Fixed
- Lost セッションの Resume ボタンを押しても新しい tmux セッションへ自動で切り替わらない問題を修正
  - `useCallback` クロージャ内で古い `sessions` 配列を `find` していたため、resume API で作成された新セッションが見つからず navigation が呼ばれなかった
  - API レスポンスと lost セッションのメタデータから直接セッションオブジェクトを組み立てて即座に遷移するよう変更
- Claude セッションでアクティブな Resume バッジ条件が壊れていた回帰を修正
  - `d4d570d` (Codex MVP) で `!isClaudeRunning` を `!supportsConversationMetadata` に取り違えていたため、Claude では絶対にバッジが出ない状態だった
  - agent プロセス検出ベースで条件を再構築

### Added
- Codex 使用量ダッシュボードに limit 到達予測時刻 (`estimatedHitTime`) を追加
  - Anthropic と同じ計算ロジックで、現在のペースから 100% 到達時刻を予測
  - 予測がある場合は status を `danger` に格上げし、チャートのマーカーと文言を一致させる

## [0.1.103] - 2026-05-08

### Fixed
- Codex 使用量ダッシュボードで 5h cycle の reset 時刻を過ぎても exhausted 状態が残り、制限超過表示が継続していた問題を修正 (#136)
  - `credits.has_credits === false` の exceeded 上書きは、5h cycle の `resetsAt` が未来の場合だけ適用
  - reset 後は最新の windowed rate limit を優先し、古い no-credits イベントで 100% 表示に戻さない
- Usage チャートが cycle start に人工的な 0% 点を追加していたため、履歴が少ない cycle で縦方向のスパイクが描画される問題を修正 (#136)
  - 実サンプルのみを時系列ソートして描画

## [0.1.102] - 2026-05-08

### Fixed
- Lost セッション（再起動などで tmux から消えたセッション）の Resume ボタンが Codex セッションでも Claude として復活していた問題を修正 (#134)
  - `LastKnownSession` に `agentSessionId` を追加し、再起動を跨いで Codex thread id を保持
  - Resume 時は `session.agent` に応じて conversation id を選択（Codex → `agentSessionId`、Claude → `ccSessionId`）し、`/sessions/history/resume` に渡す
  - conversation id が無い場合のフォールバックも `createSession` に元の agent を渡すように変更（旧挙動: claude 固定）

## [0.1.101] - 2026-05-08

### Added
- Codex セッションの会話履歴ビューア (#132)
  - ペインヘッダーの Terminal ↔ Chat トグル（既存ボタン）を Codex セッションでも有効化
  - `~/.codex/sessions/.../rollout-*.jsonl` を読み取り、`user_message` / `agent_message` をテキストとして、`function_call` / `function_call_output` を toolUse / toolResult として Claude 互換の `ConversationMessage[]` に変換
  - HTTP polling (5秒間隔) で会話を取得・更新（Codex 側に WebSocket hook がないため）
  - ConversationViewer の役割ラベルを agent 別に切替（Codex セッションでは "Codex" 表示）
- 各 agent の会話取得方式を統一する `useAgentConversation` ファサード hook
  - Claude → WebSocket stream / Codex → HTTP polling / 不明な agent → 明示的なエラー表示
  - 新しい agent を足すときは ChatView を触らずファサードに分岐を追加するだけ

### Fixed
- DesktopLayout のセッション merge で `agent` / `agentSessionId` がコピーされず、Codex セッションの会話表示が同じ cwd の Claude jsonl にフォールバックしていた問題を修正
- ChatView が `agent` 未指定時に暗黙的に Claude WebSocket にフォールバックしていた挙動を撤廃。未対応 agent は中央寄せのエラーメッセージを表示

## [0.1.100] - 2026-05-07

### Added
- ダッシュボードに Codex 用の使用量リミット表示を追加 (#130)
  - `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` の `token_count` イベントに含まれる `rate_limits` を読み取り、Anthropic Usage Limits と同じ形のチャートで表示
  - `primary` / `secondary` を `window_minutes` で 5h/7d に振り分け（24h 未満は短期サイクル扱い）
  - ダッシュボード上部に `Claude` / `Codex` の agent タブを追加（両方のデータが存在するときのみ表示）。片方しか無い環境では自動でそちら側を表示
  - `UsageLimits` コンポーネントを optional cycle 対応にリファクタし、未対応 cycle を「現在のプランでは未対応」プレースホルダで表示
  - plan_type を見出し横にバッジ表示（free / plus 等）
- Codex のレート制限到達検知 (#130)
  - `credits.has_credits === false` を検出すると `rateLimitExceeded` フラグを立て、5h cycle を 100% / exceeded で上書き、ダッシュボードに赤いバナーを表示
  - OpenAI はリミット到達時に primary/secondary を null で返すため、その後の rollout イベントで誤って古いデータを表示してしまう問題への対処も兼ねる

### Fixed
- プラン遷移後に rate_limits が空イベントになる問題への対処 (#130)
  - 例: free → plus に upgrade した直後の rollout は windows が null だが plan_type は更新済み。windows が populated されている最新イベントを別途追跡して、グラフ用データと plan/credits 用データを独立に取得する構造に変更

## [0.1.99] - 2026-05-07

### Fixed
- Codex セッションの resume が Claude セッションとして起動してしまう問題を修正 (#128)
  - `POST /sessions/:id/resume` と `POST /sessions/history/resume` が `claude -r` 固定だったため、Codex セッションを resume すると claude が起動していた
  - `AGENT_PROVIDERS` に `resumeCommand` を追加し、`agentResumeCommand(agent, sessionId)` ヘルパー経由で組み立てる構造に統一
  - active セッションの resume は tmux ペインで検出された agent を採用（リクエストボディでの override も可能）
  - 履歴からの resume はリクエストボディの `agent` フィールドを参照
  - フロント (App.tsx / SessionList.tsx) は resume API 呼び出し時に `session.agent` を渡すよう変更

## [0.1.98] - 2026-05-07

### Added
- Codex (OpenAI) を agent provider として追加 (#127)
  - セッション作成時に `agent: codex` を指定可能（デフォルトは claude）
  - セッション一覧/メタデータ行に agent badge を表示（Lost セッションも含む）
  - `~/.codex/state_5.sqlite` から Codex thread のメタデータ（タイトル、初回プロンプト、git branch）を読み取り表示
  - rollout ファイル末尾を tail して Codex の context token 使用量を読み取り、Claude と同等のメトリクス表示に対応
  - 同一ディレクトリで同じ agent が走っているかどうかをチェックする重複判定ロジックを追加

## [0.1.97] - 2026-05-01

### Fixed
- Model Usage チャートで Opus 4.5 / 4.6 / 4.7 の色がほぼ同じで判別できなかった問題を修正
  - Opus 4.7 が `startsWith('Opus')` のフォールバックで Opus 4.6 と同じ `bg-purple-500` になっていた
  - Opus 4.5 → `bg-fuchsia-500`、Opus 4.6 → `bg-violet-400`、Opus 4.7 → `bg-indigo-500` と色相段階に分散して識別性を改善

## [0.1.96] - 2026-05-01

### Fixed
- セッションリストの `ctx` インジケーターが macOS で常に 100%(赤)になる問題を修正 (#125)
  - `anthropic-models.ts` が `~/.claude/.credentials.json` のみ参照しており、Keychain にトークンを保存している新しい Claude Code 環境で `/v1/models` 取得に失敗
  - 結果として `contextMaxTokens` が fallback の 200,000 になり、Opus 4.7 (1M context) のような実際の上限が大きいセッションで `contextPercent` が 100 で頭打ちになっていた
  - file → Keychain のトークン取得ロジックを `utils/claude-credentials.ts` に共通化し、`anthropic-models.ts` / `anthropic-usage.ts` 両方で利用
  - `anthropic-models.ts` の User-Agent も `cchub/<version>` に変更(v0.1.93 で `anthropic-usage.ts` に行った変更を踏襲)
  - Linux は元から `.credentials.json` ベースで動いていたため挙動変更なし

## [0.1.95] - 2026-04-30

### Fixed
- 会話履歴ボタンが macOS で常に disabled になる問題を修正 (#123)
  - 非標準パス(`~/.local/bin/claude`、`/opt/homebrew/bin/claude` 等)で起動した Claude Code を `isClaudeProcess` が認識できず、ペインの `currentCommand` が tmux の `pane_current_command` (バージョン番号 `2.1.123` 等) のまま伝搬していた
  - `isClaudeProcess` の判定を `/(?:^|\/)claude(?:\s|$)/` 正規表現ベースに変更し、フルパス起動を含む全パターンを検出
  - `buildSessionsList` で ps ベースの検出結果を使ってペインレベルの `currentCommand` も `'claude'` に正規化(従来は session レベルのみ正規化されていた)
  - Linux の挙動は変更なし(元から `pane_current_command` が `claude` を正しく返す)

## [0.1.94] - 2026-04-30

### Added
- macOS Keychain によるパスワード保存 (#121)
  - `cchub setup -P pass` で渡されたパスワードを `~/Library/LaunchAgents/com.cchub.server.plist` に直接埋め込む代わりに、macOS Keychain (`service: cchub`) に保存
  - `cchub` 起動時の優先順位: `-P` CLI 引数 → `CCHUB_PASSWORD` 環境変数 → Keychain
  - 起動ログにパスワード取得元を表示 (`(Keychain)` / `(env)`)
  - `cchub uninstall` で Keychain エントリも削除
  - 既存インストールは plist の `-P` がそのまま使われるため互換性あり。Keychain への移行は次回の `cchub setup -P pass` で自動的に行われる
  - Linux はヘッドレスサービス向けの信頼できる secret store がないため従来の `EnvironmentFile` 方式を維持

### Fixed
- `cchub --help` で `setup` の説明が常に「systemd service setup」となっていたのを「Register service (systemd on Linux, launchd on macOS)」に変更
- launchd plist の文字列補間に XML エスケープを追加（`<`, `>`, `&`, `"`, `'` を含むパスワードでも plist が壊れない）

## [0.1.93] - 2026-04-30

### Fixed
- セッションリストのステータス表示が macOS で正しく動作するよう修正 (#119)
  - `/api/notify/hook-status` が必須4イベント（Stop / PreToolUse / UserPromptSubmit / PostToolUse[AskUserQuestion]）を個別検証するように変更
  - 設定不足時のセットアップバナーが「全くないとき」だけでなく「不足があるとき」に表示されるように
  - セットアップ用プロンプトが4イベントすべてをカバー、`prompt-recorder.sh` 等の既存 hook を保持するよう Claude へ指示
- 手動 `/recap` slash command の出力がセッションリストに反映されるように修正
  - `readLastAwaySummary` → `readLastRecap` にリネームし、`subtype:'local_command'` も `<command-name>/recap</command-name>` を直前の user entry に持つ場合は recap として採用
  - 自動 `away_summary` と手動 `/recap` のうち最新を採用
- `readLastLines` のバッファ推定不足を修正
  - 200 バイト/行 → 2KB/行スタートで不足時は 4倍ずつリトライ（2K → 8K → 32K）、最終手段は全読み
  - Claude Code の JSONL は tool result 埋め込みで平均 2KB/行のため、`300` 指定でも実質 28 行しか読めていなかった
- `cchub status` が macOS で `systemctl not found` で落ちる問題を修正
  - `platform()` で OS 判定し、`darwin` では `launchctl list com.cchub.server` を使用、PID と LastExitStatus を表示

### Added
- Anthropic API の使用量取得エラーをダッシュボードに表示
  - エラー種別（rate-limited / no-credentials / unauthorized / fetch-failed / unknown）に応じたメッセージ
  - レート制限中はキャッシュ値を `(showing cached value)` バッジ付きで表示し、再試行までのカウントダウンを表示
  - 429 レスポンスの `Retry-After` ヘッダーを尊重（5分〜1時間にクランプ）
- macOS Keychain からの OAuth トークン取得をサポート
  - 新しい Claude Code が `~/.claude/.credentials.json` ではなく Keychain (`Claude Code-credentials`) に資格情報を保存するため、フォールバックを追加
- `User-Agent` を `cchub/<version>` に変更（旧 `claude-code/2.0.32` は Claude Code への impersonation だったため）
- DashboardPanel の幅を画面サイズに応じて拡張（xl: 420px、2xl: 480px）

### Changed
- `.gitignore` に `.claude-user-prompts/`、`.playwright-mcp/`、ルート直下 `*.png` を追加（ローカル開発の副産物を除外）

## [0.1.92] - 2026-04-29

### Changed
- 会話履歴ビューの背景色をセッションテーマカラーに同期
  - ターミナル背景と一致した色（pink / indigo / teal 等）でチャットビュー全体（コンテナ・エコー行・ローディング表示）を着色
  - 視覚的な一体感を向上、セッション切替時のテーマも追従

## [0.1.91] - 2026-04-29

### Added
- 会話履歴ビュー（chat mode）を追加 (#116)
  - ターミナルの xterm 領域を Claude の会話履歴に置き換える別表示モード。`fs.watch` で JSONL を監視しリアルタイム更新（150ms debounce）
  - WebSocket プロトコルに `subscribe-conversation` / `initial-conversation` / `conversation-update` / `unsubscribe-conversation` を追加
  - ペインヘッダーの単一アイコントグルでターミナル⇄会話履歴を切替（Claude 起動中のみ有効）
  - ペインごと・セッションごとの表示モードを localStorage に永続化（split/再マウントでも維持）
  - 「処理中」「入力待ち」バッジを `indicatorState` ベースに統一（接続状態ではなく Claude の実状態を反映）
- インライン画像のライトボックス表示
  - 会話履歴・Read 等のツール結果に含まれる画像をタップで全画面表示。背景タップ／×ボタン／Esc で閉じる
- 会話履歴のフォントサイズ調整
  - ピンチズーム / 左下のフォントコントロール（−／A／＋）でサイズ変更、localStorage に永続化
  - 通常時は `Aa` の小トリガーのみ表示、変更時のみフルコントロール表示
- 入力エコー行
  - FloatingKeyboard / InputBar から送信した文字を会話履歴下部にプロンプト風表示。送信先（ターミナル）が隠れていても入力中の文字を確認可能
- 入力フォーム（デスクトップ）
  - PC では会話履歴の下に textarea + 送信ボタンを表示。モバイルは Terminal InputBar、タブレットは FloatingKeyboard を流用

### Changed
- 会話履歴ビューの情報密度を向上（メッセージ間隔・行高・マージンの全体的な詰め）
- ペインヘッダーのターミナル/チャット切替を 2 アイコンから単一アイコン（切替先表示）方式に変更
- ペインが 1 つしかない時は close（×）と zoom（最大化）ボタンを非表示
- スクロール時のキーボード制御
  - 会話履歴を上にスクロールするとソフトキーボードを自動非表示にし表示領域を拡大
  - 一番下まで戻るとキーボードを再表示（タッチ駆動 + 600ms クールダウンでレイアウトシフトの振動を防止）

## [0.1.90] - 2026-04-28

### Fixed
- モバイル端末で FileViewer の Copy Prompt ボタンを押してもプロンプトテキストが入力欄に挿入されない不具合を修正 (#114)
  - 6 週間前の Terminal.tsx 分割リファクタで失われていた InputBar へのテキスト注入経路を復元
  - InputBar に forwardRef + useImperativeHandle で `setText(text)` を公開

## [0.1.89] - 2026-04-27

### Changed
- セッションカードの recap テキスト色を `text-zinc-400` (灰) → `text-amber-200` (薄い琥珀) に変更し、暗背景での視認性とカードの華やかさを改善
- recap タイムスタンプを `text-zinc-600` → `text-zinc-500` に微調整

## [0.1.88] - 2026-04-27

### Fixed
- macOS で `/api/sessions` のレスポンスから `currentPath` / `panes` / `ccSummary` 等が欠落していた問題を修正 (#110)
  - `ps -eo tty,args --no-headers` (GNU 専用) を `ps -A -o tty,args` + ユーザー空間でのヘッダースキップに変更し、BSD ps と GNU ps の両方で動作するように
  - `tmux list-panes` のフィールドセパレータを `\x1f` から ASCII の `||~~||` に変更（macOS + Bun.spawn で 0x1f が `_` に化ける問題を回避）

## [0.1.87] - 2026-04-27

### Changed
- デスクトップ表示のヘッダーアイコンとペインヘッダーアイコンを 14-16px から 18px に拡大、余白も `p-1` → `p-1.5` に調整して視認性を改善
- ペインヘッダーのタイトル文字サイズを `text-xs` (12px) → `text-base` (16px) に拡大

### Removed
- ペインヘッダーの黄色「キャッシュクリア & リロード」ボタンを削除（通常リロードと紛らわしいため）

## [0.1.86] - 2026-04-26

### Fixed
- 未知の拡張子のテキストファイルが File Viewer で開けず base64 化されていた問題を修正
  - NUL バイト / 制御文字のヒューリスティックで判定し、テキストっぽければ UTF-8 で返す
  - バイナリファイルは引き続き base64 で返却

## [0.1.85] - 2026-04-26

### Fixed
- ConversationViewer で Read ツールが画像を返した際に「(出力なし)」と表示されていた不具合を修正
  - jsonl パース時に `tool_result` の content array から `type: "image"` ブロックを抽出し、base64 画像をインライン表示

### Changed
- `formatRelativeTime` を `frontend/src/utils/format.ts` に集約し、SessionList / SessionHistory / PromptSearch の重複実装を統一
- 秒単位の相対時刻表示に対応（`time.secondsAgo` キー追加）
- 未使用の `UsageTracker` サービスと `PromptSearch` コンポーネント、deprecated な `getSessionIdFromTty` を削除（-356 行）
- リリーススキルを PR ベースのフローに変更し、リリース専用ブランチ (`release/vX.X.X`) を切る運用に統一

## [0.1.84] - 2026-04-25

### Fixed
- 日本語入力モードの InputBar 下段ボタン (履歴 / ファイル / クリア / ↑ / ↓ / 送信) の幅を `w-9` (36px) → `w-14` (56px) に拡大
  - スマートフォンでタップしづらかった状態を解消

## [0.1.83] - 2026-04-25

### Fixed
- File Viewer の Markdown プレビューで相対パス画像 (`![](docs/foo.png)` 等) が読み込めず壊れていた問題を修正
  - `<img src>` をそのままブラウザに渡していたため、フロントエンドのオリジン (`/docs/foo.png`) として解決され 404 になっていた
  - Markdown ファイルのディレクトリを基準に解決し、`/api/files/raw` 経由で配信するよう変更
  - `http(s)://`、`data:`、`blob:` 等の絶対 URL は従来通りパススルー

### Added
- README にスクリーンショット (タブレット全景・セッション一覧・モバイル端末) を追加 (`docs/images/`)

## [0.1.82] - 2026-04-25

### Changed
- セッション一覧カードのレイアウトを圧縮
  - タイトルとパスを同じ行に並べる (例: `ホーム  /home/m0a`)
  - recap タイムスタンプ (`2h ago` 等) を recap 本文の末尾にインライン配置
  - recap ブロックの枠線・背景・"RECAP" ラベルを削除しフラット化
  - recap が表示されているセッションでは last-prompt サマリを非表示 (recap が同じ情報を含むため)

## [0.1.81] - 2026-04-25

### Added
- セッション一覧の各セッションカードに Claude Code の auto-recap (`away_summary`) を表示
  - Claude Code が端末をアンフォーカス後 3 分以上経つと自動生成する 1〜3 文のサマリ (「今何やってるか + 次のアクション」) をカード上部に表示
  - `RECAP · 2h ago` のラベル + 相対タイムスタンプ + 本文 (3行で line-clamp)
  - recap が無いセッションでは表示されず、既存の last-prompt サマリのみ
  - セッション検索 (Ctrl+B のフィルタ) でも recap 本文がヒット対象に
  - `~/.claude/projects/<dir>/<session>.jsonl` 内の `system/away_summary` エントリを末尾から拾う実装。既存の jsonl 読み取りキャッシュ (5秒 TTL) に乗るためオーバーヘッドなし

## [0.1.80] - 2026-04-25

### Refactored
- デッドコード掃除 (-981 行)
  - 未使用ファイル7個を削除: `UrlMenu.tsx`, `SessionListMini.tsx`, `SessionTabs.tsx`, `SessionTab.tsx`, `LanguageSwitcher.tsx`, `dashboard/CostEstimate.tsx`, `dashboard/LimitWarning.tsx`
  - 未使用 state/関数/prop の削除 (Terminal/InputBar の URL menu dead state、`onReload`、`hideDashboardTab` 等)
  - 未使用 import の削除 (`Settings`, `PaneInfo`, `UrlMenu`, `symlink`)
  - 未使用 npm パッケージ削除: `@xterm/addon-web-links`, `qrcode.react`
- 機能変更なし。dev 環境で sessions/dashboard/file browser の動作確認済み

## [0.1.79] - 2026-04-25

### Fixed
- WS 再接続時に Claude Code の入力プロンプト (permission / plan / AskUserQuestion 等) が画面に表示されない問題を修正
  - v0.1.78 で追加した「再接続時 initial-content 破棄」が副作用となり、再接続中に到着したプロンプト UI が xterm に書き込まれず、ユーザーがリロードするまで気づかない状態を引き起こしていた
  - `onInitialContent` を v0.1.77 動作に戻し、wasExpected=false でも書き込む。clear sequence は visible のみ (ESC[2J + ESC[H) でユーザーのスクロール位置は保持
  - scrollback 二重化は再現するが、上流の [Claude Code TUI redraw バグ](https://github.com/anthropics/claude-code/issues/49086) が支配的のため許容
- v0.1.78 で導入した CJK の `rescaleOverlappingGlyphs: true` (文字重なり対策) は維持

## [0.1.78] - 2026-04-25

### Fixed
- ターミナル表示の不安定さを2点修正
  - **scrollback 二重化**: WebSocket 再接続時に古い履歴と新しい initial-content が重複し、スクロールアップで同じ出力が2回表示される問題を解消。再接続時は initial-content を破棄して live %output に任せる方式に変更
  - **CJK グリフの重なり**: 日本語+ASCII 混在出力で文字が隣接セルに侵食する問題を `rescaleOverlappingGlyphs: true` で解消

## [0.1.77] - 2026-04-24

### Fixed
- コンテキスト使用率が正しく計測されない問題を修正
  - モデルの context window max をハードコード (200k) から Anthropic `/v1/models` API 経由の動的取得に変更
  - Opus 4.7 (1M context) で 100% cap されていた問題を解消、`/context` コマンドと ±1% 以内で一致

### Changed
- トークン使用量表示を output のみから累計 used (input + cache_creation + output) に変更
  - cache_read は billing 10% なので除外、実質のレート制限寄与度に近い値を表示
  - UI ラベル `out` → `used`、tooltip に内訳 (in / cache_create / cache_read / out)

### Added
- `backend/src/services/anthropic-models.ts` 新規
  - OAuth トークンで `/v1/models` を叩き、`model_id → max_input_tokens` を 24h キャッシュ

## [0.1.76] - 2026-04-24

### Fixed
- メモリメトリクスを macOS でも取得可能に
  - `/proc` 依存の実装を `ps -A -o pid=,ppid=,rss=` に統一（Linux/macOS 共通）
  - 1 秒 TTL のプロセステーブルキャッシュを追加し、複数セッション間で `ps` spawn を共有

## [0.1.75] - 2026-04-24

### Added
- セッション一覧の各カードにメトリクス表示を追加
  - **コンテキスト使用率**: .jsonl の最新 usage から算出、200k max に対する % をプログレスバーで可視化 (緑 <60% / アンバー 60-80% / 赤 ≥80%)
  - **メモリ使用率**: tmux pane_pid から /proc ツリーを走査して RSS 合計を算出
  - **トークン使用量**: .jsonl 全スキャンで output トークン累計を算出
- mtime+size ベースのキャッシュで 2 回目以降 56-83ms の応答
- デスクトップ (SessionList) とモバイル/タブレット (SessionListMini) 両方に対応

### Changed
- セッションカードの要約/プロンプト表示を `truncate` (1行+...) から `line-clamp-2` (最大2行) に変更し、読みやすさを向上

## [0.1.74] - 2026-04-22

### Added
- TypeScript 7.0 beta (tsgo) による型チェック基盤を導入（tsc 5.9.3 比で約6.8倍高速化）
- 各 workspace に `typecheck` スクリプト追加、root から `bun run typecheck` で一括実行可能
- CI (`.github/workflows/test.yml`) に typecheck ステップを追加

### Fixed
- backend/frontend で検出されなかった既存型エラー 13 件を修正
  - `SessionState` の narrow 解除、lost session の必須プロパティ補完
  - テストコードの optional chaining 化
  - frontend の CSS module 宣言（`vite-env.d.ts`）
  - `SessionResponse` 型の import 漏れ
- `backend/tsconfig.json`: `bun-types` → `bun`（`@types/bun` に整合）

## [0.1.73] - 2026-04-12

### Added
- File Viewer: ファイルアップロード/ダウンロード機能（動画など大きいファイルも対応）
- `POST /files/upload` — 複数ファイル一括アップロード、ストリーミング書き込み（Bun.write）
- `GET /files/download` — 添付ダウンロード、ストリーミング配信（Bun.file）
- `GET /files/raw` — 画像/動画/音声の直接ストリーミング配信（Range request対応）
- 動画再生（MP4, WebM, MOV等）と音声再生（MP3, WAV, FLAC等）をFileViewerに追加
- アップロード成功/失敗のトースト通知
- モバイルレイアウトにもアップロード/ダウンロードボタンを追加

### Fixed
- 大きい画像が1MB制限で崩れて表示される問題を修正（/files/raw ストリーミングに変更）
- サーバーの最大リクエストボディサイズを10GBに拡張
- モバイルPWAでFileオブジェクト参照が切れる問題にBlob変換で対応
- 動画シーク・プログレッシブ再生対応（Range request / 206 Partial Content）
- 動画プレーヤーの画面サイズ自動調整（object-contain, playsInline）

## [0.1.65] - 2026-04-11

### Added
- 会話ビューアーでツールブロックにdescription要約を表示（折りたたみ時に「Bash: コマンドの説明」のように表示）
- G2 Glasses: 同じくツール名にdescriptionを併記

## [0.1.64] - 2026-04-10

### Fixed
- ゾンビWebSocket接続の検出と切断（60秒間pingがない接続を閉じる）
- デバイススリープ/ネットワーク切断でcloseイベントが発火しないケースに対応

## [0.1.63] - 2026-04-10

### Fixed
- ダッシュボードの使用量データがレートリミット(429)で表示されない問題を修正
- Anthropic usage APIのレスポンスを60秒キャッシュし、429時は5分バックオフ

## [0.1.62] - 2026-04-10

### Fixed
- セッションインジケーターが許可待ち/入力待ちなのに「処理中」と表示される問題を修正
- hookオーバーライドTTLを24時間に統一（許可プロンプトで長時間待ってもステータスが消えなくなった）
- jsonlからPendingTool状態を検出（新しいtool_useがjsonl未記録でもバッジ表示）

### Added
- G2 Glasses: requestContentAndWait でターミナルコンテンツ取得の信頼性向上

## [0.1.61] - 2026-04-09

### Added
- glasses-upload スキル（EVEN Hubへのビルド・アップロード・Beta切替を自動化）

## [0.1.60] - 2026-04-09

### Fixed
- G2 Glasses: 会話ページネーションのページ数計算を行数ベースに統一（最終ページに到達できない問題を修正）

## [0.1.59] - 2026-04-09

### Added
- G2 Glasses: 行数ベースのページネーション（文字幅計算でCJK/ASCII自動判定）
- G2 Glasses: 複数メッセージ表示（短いメッセージを7行に詰め込み）
- G2 Glasses: スワイプ時の表示メッセージ数分ジャンプ

### Changed
- G2 Glasses: 全コンテナからボーダー削除、borderWidth: 0を明示
- G2 Glasses: ヘッダー/フッター高さを36pxに統一
- G2 Glasses: セッションリスト表示を7行に制限（スクロールインジケータ解消）
- G2 Glasses: display.tsリファクタリング（コンテンツヘルパー抽出、DRY化）

## [0.1.58] - 2026-04-09

### Fixed
- G2 Glasses: 会話表示からツール結果のみのメッセージをスキップ、連続アシスタントメッセージをマージ
- G2 Glasses: テキスト内容を先、ツール呼び出しを後に表示するよう改善
- G2 Glasses: conversationモードでtapして会話リフレッシュ＋WS再接続
- G2 Glasses: WS再接続時に自動re-subscribe
- G2 Glasses: EVEN Hub SDK bridge初期化のタイムアウトを5秒に延長
- G2 Glasses: phone UIのWS診断で動的インポートを使用し初期化順エラーを解消
- G2 Glasses: シミュレーター用にdev環境でlocalhost URLを自動設定

## [0.1.57] - 2026-04-08

### Fixed
- G2 Glasses: 選択肢モードでrequest-contentにより最新ターミナル画面を取得するよう修正
- G2 Glasses: セッション再ソートによる意図しないセッション切替を防止
- G2 Glasses: フォールバック選択肢 (y/n/skip) を廃止

### Added
- G2 Glasses: phone UIにWS診断情報を追加
- G2 Glasses: ブラウザデバッグUIにWS状態・バッファ表示を追加
- G2 Glasses: ws-clientにrequestContentメソッドを追加

## [0.1.56] - 2026-04-08

### Changed
- Terminal.txを2397行→1151行に分割（InputBar, SelectionOverlay, UrlMenu, useSelectionMode, terminal-themesを抽出）

## [0.1.55] - 2026-04-08

### Changed
- ソフトキーボードのデフォルトを日本語入力モードに変更
- glasses app.jsonのpackage_id/permissions形式をEVEN Hub仕様に修正

## [0.1.54] - 2026-04-08

### Added
- デスクトップブラウザで長押しによるテキスト選択モードを追加（タブレット/スマホと同じUX）
- 長押し後のドラッグで選択範囲をリアルタイム拡張
- S/Eハンドルのマウスドラッグによる選択範囲の微調整
- Selection Modeバッジ/Copy・Cancelパネルの位置を選択範囲と被らないよう自動調整

### Fixed
- マウスリリース後にxterm.jsが選択範囲を変更する問題を修正（pointer-events制御）
- S/Eハンドルドラッグ後にmouseupが検知されない問題を修正（captureフェーズ使用）

## [0.1.53] - 2026-04-08

### Changed
- any/as型キャストを除去し、ExtendedSessionResponse型を全体で統一
- buildSessionsListの戻り値をobject[]からExtendedSessionResponse[]に変更
- Bun WebSocketハンドラにServerWebSocket<MuxData>型を適用
- CLAUDE.mdのコンポーネント一覧を実ファイルと同期

## [0.1.52] - 2026-04-08

### Added
- lostセッションに削除ボタンを追加（Resumeの横に表示）

## [0.1.51] - 2026-04-07

### Added
- **G2スマートグラス コンパニオンアプリ** (`glasses/` ワークスペース)
  - セッション一覧（ステータスアイコン付き、リングスワイプで選択）
  - 会話表示（ページ送り、リアルタイム更新3秒ポーリング）
  - 選択肢モード（カーソルキー送信でClaude Codeの選択画面を操作）
  - スマホ設定画面（CC Hub紹介、セットアップ手順、URL入力＆自動補完）
  - LocalStorage共有（スマホで設定→メガネが自動検出して接続）
  - ツール実行のコンパクト表示（[Edit] path, [Bash] command 等）
- conversation APIに`?last=N`パラメータ追加

## [0.1.49] - 2026-04-07

### Fixed
- lostセッションのccSessionId無しでのresume対応

## [0.1.47] - 2026-04-06

### Changed
- waitingForInputフィールドを削除（hookベースのindicatorに統一）

## [0.1.44] - 2026-04-05

### Fixed
- AskUserQuestionのPreToolUseでwaiting_inputステータスを表示

## [0.1.42] - 2026-04-04

### Fixed
- PreToolUseイベントのブラウザ通知を抑制（ステータス更新のみ）

## [0.1.41] - 2026-04-04

### Changed
- セッションインジケーターをhookイベント専用に変更（jsonl/ps判定を廃止）
  - PreToolUse/UserPromptSubmit → processing
  - Stop/SubagentStop → completed
  - PostToolUse(AskUserQuestion) → waiting_input
- ~/.claude/settings.jsonにPreToolUse/UserPromptSubmit hookを追加

## [0.1.40] - 2026-04-04

### Changed
- psのwchan解析を廃止（Node.jsでは常にdo_epoll_waitで無意味）
- セッションインジケーターをhook/jsonlベースに変更
- jsonlキャッシュTTLを5s→2sに短縮
- processRunningマップと関連ロジックを完全削除（-81行）

## [0.1.39] - 2026-04-04

### Fixed
- cchub updateがサービス登録パスのバイナリを更新するように修正
- CLIバイナリとサービスバイナリが異なるパスにある場合、両方を更新

## [0.1.38] - 2026-04-04

### Fixed
- メタデータ（テーマ・タイトル）消失のrace condition修正
  - lastKnownSessionsを別ファイル（last-known-sessions.json）に分離
  - 5秒ごとのスナップショット書き込みがmetadata本体を上書きしなくなった

### Changed
- コード健全化
  - フロントエンドlintエラー3件修正（CSS parse, noImportantStyles, noUselessCatch）
  - バックエンドlint修正（parseInt radix, unused param, optional chain）
  - zod統一（shared v3→v4）、ローカルスキーマ重複削除
  - listPanesにisActiveフィールド追加
  - 旧メタデータファイル（session-themes.json, session-titles.json）の自動削除
- 完了済みGitHub issueをクローズ（#1, #2, #12, #47）

## [0.1.37] - 2026-04-04

### Fixed
- リブート後のlostセッションがリフレッシュで消えなくなった
- lostセッションのResume時にclaude -rで会話引き継ぎ

## [0.1.36] - 2026-04-04

### Added
- リブート後のlostセッションにccSessionIdを保存
- lostセッションのResumeでclaude -rによる会話引き継ぎ

## [0.1.35] - 2026-04-04

### Fixed
- デスクトップ版コピペ（テキスト選択、Ctrl+C/V、右クリックメニュー）
- デスクトップ版フォントサイズ変更（Ctrl+=/-/0）
- iPad safe-area-inset-top対応
- マウストラッキングリセット

### Changed
- CLAUDE.md/README全面更新（WebSocket /ws/mux, 全サービス・API・コンポーネント文書化）

## [0.1.5] - 2026-03-20

### Changed
- スマホ日本語入力を二段レイアウトに変更（上:入力欄幅いっぱい、下:ボタン列）
- ボタン配置: 左に履歴/ファイル/ABC/クリア、右にカーソル上下/送信
- ボタンサイズを44pxタッチターゲットに拡大

### Fixed
- UserPromptSubmitフックの不要な通知を抑制

## [0.1.4] - 2026-03-20

### Changed
- Connecting表示を全画面オーバーレイから左上の小さなバナーに変更（接続中もターミナル操作可能に）

## [0.1.3] - 2026-03-20

### Fixed
- ファイルビューアで長押し時にブラウザのコンテキストメニュー（ダウンロード/共有/印刷）が表示される問題を修正

## [0.1.2] - 2026-03-20

### Added
- セッション一覧でペインを長押しして閉じる機能（確認ダイアログ付き）

### Fixed
- zod v4でペイン操作API（close/focus/split/respawn）が500エラーになる問題を修正

## [0.1.1] - 2026-03-19

### Fixed
- macOSでtmux制御モードが動作しない問題を修正（`script`→`expect`でPTYラッパー）

## [0.1.0] - 2026-03-19

### Added
- ターミナル長押しテキスト選択（タッチデバイス対応）
  - 長押しで選択モード開始、ドラッグで文字レベル選択
  - S/Eハンドルで選択範囲をドラッグ調整
  - 選択テキストのプレビューパネル表示
  - Copy/Cancelボタン、クリップボードコピー対応

## [0.0.99] - 2026-03-19

### Added
- FileViewerにCopy Prompt機能（行選択→コメント→ターミナル入力欄にセット）
- 日本語入力に送信ボタン(↵)とクリアボタン(×)を追加（スマホ・タブレット両対応）
- Markdown/HTMLファイルのSource/Preview切替ボタン

### Changed
- FileViewerの行番号を常時表示（ワードラップ時も）
- 行全体をタップで選択可能に（行番号以外も）
- タブレットでFileViewer表示中はFloatingKeyboardを非表示に

## [0.0.98] - 2026-03-18

### Changed
- zod 3→4、@hono/zod-validator 0.5→0.7 にメジャーアップグレード
- vite 6→8、@vitejs/plugin-react 4→6 にメジャーアップグレード

## [0.0.97] - 2026-03-18

### Added
- share-tokenサービスのユニットテスト追加（18テスト）

### Changed
- パッチ/マイナー依存関係更新（hono, react, tailwindcss, i18next等）

## [0.0.96] - 2026-03-18

### Removed
- 非推奨TabletLayoutコンポーネント削除（478行、DesktopLayout+isTabletに統合済み）
- 未使用isExternalフィールド、onReload prop、レガシーsessionsフラット配列
- ext:プレフィックス正規化、旧localStorageキー掃除、旧ペインタイプ変換等のマイグレーションコード

## [0.0.95] - 2026-03-18

### Fixed
- ファイルブラウザでシンタックスハイライトが付かないことがある問題を修正

## [0.0.94] - 2026-03-18

### Fixed
- ソフトキーボードで`/`を押すと`?`が付く問題を修正（タッチ+マウスの二重発火による長押しタイマーの残留）

## [0.0.93] - 2026-03-17

### Changed
- タブレットFloatingKeyboardの日本語入力をスマホと統一（textarea + Enter×2送信 + ブラケットペースト）

## [0.0.92] - 2026-03-17

### Added
- スマホ日本語入力に履歴ボタン追加（FloatingKeyboardと履歴共有）
- スマホ日本語入力を複数行編集対応（textarea化）
- Enter×2で送信、複数行はブラケットペーストモードで一括送信

### Fixed
- ビューアページの縦スクロール有効化

## [0.0.91] - 2026-03-16

### Fixed
- ビューアページで画面下部のターミナル内容が見えない問題を修正（縦スクロール有効化）

## [0.0.90] - 2026-03-16

### Changed
- Funnelをオンデマンド化: 共有トークン生成時にON、全トークン消滅時にOFF
- 起動時の自動Funnel設定を廃止（前回のFunnel残骸はクリーンアップ）

## [0.0.89] - 2026-03-16

### Added
- Tailscale Funnel自動設定: サーバー起動時にポート8443で外部公開を自動セットアップ
- 共有ダイアログのQRコード/URLが自動的にFunnel経由の外部URLを使用

### Fixed
- Funnelとバックエンドのポート競合を修正（別ポート8443で転送）
- ViewerPageのターミナル固定幅レンダリングとフォントサイズ調整

## [0.0.88] - 2026-03-16

### Added
- プレゼンテーションモード: セッションを読み取り専用URLで共有可能に
- 共有トークン管理（生成・一覧・無効化、最大5トークン/セッション、有効期限付き）
- QRコード表示付き共有ダイアログ（デスクトップ/タブレット/モバイル全対応）
- 読み取り専用WebSocketエンドポイント（/ws/view/:token）で入力操作を遮断
- ビューア側フォントサイズ調整（提供側に影響なし）
- 横スクロール対応（タブレットの広い画面をスマホで閲覧可能）
- Tailscale Funnel URL自動検出によるVPN外共有

## [0.0.87] - 2026-03-15

### Fixed
- ターミナルのスクロール不能問題を修正（初期接続時にスクロールバックをxterm.jsに送信）
- Connectingオーバーレイがタッチ操作をブロックしないよう修正

## [0.0.86] - 2026-03-14

### Fixed
- ファイルブラウザのタッチターゲット・フォントサイズを拡大（スマホ操作改善）

## [0.0.85] - 2026-03-14

### Fixed
- バッジ表示を indicatorState ベースに統一（processing→緑cc、waiting_input→黄、idle→なし）

## [0.0.84] - 2026-03-14

### Fixed
- アイドル状態（UserInput/end_turn）を completed として扱い、不要な入力待ちバッジを抑制

## [0.0.83] - 2026-03-14

### Added
- スマホ: セッション長押しでメニューダイアログ（タイトル編集・テーマ変更・削除）
- タブレット: メニューダイアログにカスタムタイトル入力欄を追加

### Fixed
- WebSocket再接続時にスクロール位置を保持（スクロールバッククリア・scrollToBottomをスキップ）
- processing状態のhook TTLを30秒→5分に延長（誤った入力待ち表示を削減）

## [0.0.82] - 2026-03-14

### Fixed
- WebSocket再接続時のターミナルちらつき・スクロールリセットを軽減

## [0.0.81] - 2026-03-14

### Added
- サーバーサイドでのカスタムセッションタイトル保存（session-metadata.jsonに統合）
- セッション一覧を全画面表示（ファイルビューワーと同様）
- タブレット/PCでセッションカード・履歴を2列グリッド表示
- タブレットでfirstPrompt常時表示、summary複数行表示
- hook経由のステータス検知改善（UserPromptSubmit、Stop、AskUserQuestion）

### Fixed
- Bashツール等の許可待ちで「許可待ち」バッジを表示
- スマホ版セッション一覧でカスタムタイトルを表示
- cchub notifyがdev環境にHTTPSで送信するように修正
- 履歴プロジェクトをパス辞書順でソート

## [0.0.29] - 2026-02-07

### Added

- **Git差分ビューア** - ファイルビューアの「変更」タブにClaude/Git切り替えトグルを追加
  - Gitモード: `git status --porcelain` + `git diff` でワーキングツリーの変更を表示
  - Claude変更とGit変更をセグメントボタンで切り替え（デフォルト: Git）
  - 一覧/ツリー表示モード（localStorageで保存）
  - ファイルクリックで既存のDiffViewerにunified diffを表示
  - 新規API: `GET /api/files/git-changes/:workingDir`, `GET /api/files/git-diff/:workingDir`

- **ブラウザバックジェスチャー対応** - FileViewerでhistory.back()によるナビゲーション
  - diff表示 → 変更一覧 → ブラウザビュー → ターミナル の順に戻る
  - `window.history.pushState` / `popstate`イベントで実装

### Fixed

- **Biomeリント設定整備** - `biome.json`でa11y/style系ルールをwarnに設定
  - `useButtonType`, `noSvgWithoutTitle`, `noStaticElementInteractions`等8つのa11yルールをwarn化
  - `noExplicitAny`, `noNonNullAssertion`, `useExhaustiveDependencies`等もwarn化
  - バックエンド16ファイル、フロントエンド14ファイルの自動修正可能なlintエラーを修正
  - DesktopLayout.tsx: `useEffect`の変数宣言順序を修正
  - FloatingKeyboard.tsx: `getDefaultPosition`をモジュールレベルに移動

## [0.0.28] - 2026-02-07

### Added

- **ネットワーク遅延モニター** - ダッシュボードにリアルタイム遅延表示カードを追加
  - WebSocket ping/pong（10秒間隔）とAPI ping（30秒間隔）の2種類を計測
  - CSSベースのスパークラインで過去30データポイントの履歴を可視化
  - 色分け表示: 緑(<50ms), 黄(50-150ms), 赤(>150ms)
  - WS切断時は最後の計測値を薄く表示（20秒以内のpong受信で接続判定）

## [0.0.27] - 2026-02-07

### Performance

- **Sessions API レイテンシ 48.6%削減** (70.84ms → 36.39ms)
  - `capture-pane`の重複呼び出しを統合（2回→1回/セッション）
  - `ps`コマンドをバッチ化（N回→1回で全TTYのClaude検出・プロセス状態チェック）
  - `listSessions` 2秒TTLキャッシュ追加
  - TTY→SessionIDマッピング 10秒TTLキャッシュ追加
  - フロントエンド`useSessions`のfetchリクエスト重複排除

- **ターミナルWebSocketホットパス最適化**
  - デバッグhexログを除去（毎キーストロークで`Array.from`+`map`+`join`+`console.log`が走っていた）
  - PTY切断時に30秒の猶予期間を追加（タブレットのスリープ復帰時に即座再接続）

### Added

- **ターミナルレイテンシベンチマークスイート** (`backend/tests/benchmark/`)
  - Single char echo RTT、コマンド実行RTT、スループット、Sessions APIの4メトリクス計測
  - p95/p99パーセンタイル統計

## [0.0.26] - 2026-02-06

### Added
- **オンボーディングウォークスルー** - 初回ユーザー向けスポットライト式ガイド
  - デスクトップ/タブレット/モバイル各デバイス対応
  - キーボード操作、分割ペイン、セッション一覧の使い方を順に説明
  - `beforeAction`パターンで説明前にUIを自動操作（キーボード表示など）

- **ターミナルリフレッシュ機能** - 表示崩れ時の軽量リカバリー
  - WebSocket経由で`tmux refresh-client -S`を送信
  - WebSocket再接続時に自動リフレッシュ

- **ペインごとの分割ボタン** - デスクトップモードで各ペインヘッダーに分割ボタンを配置

### Changed
- **ハンバーガーメニュー削除** - DesktopLayoutのサイドパネルオーバーレイを廃止（PaneContainer内のセッション一覧サイドバーに統合）
- **サイドバーリサイズハンドル改善** - 透明なオーバーレイ方式に変更、タッチ領域拡大（タブレット24px）
- **サイドバーがターミナル端に被さるレイアウト** - xterm文字幅端数による隙間を軽減
- **タブナビゲーション自動フィット** - フォントサイズ縮小+truncateで狭いパネルでも1行表示
- **リロードボタンをページ全体リロードに変更**

### Fixed
- モバイルターミナルスクロールの不自然な挙動（閾値調整、二重スクロール解消）
- モバイルでキーボードオンボーディングが表示されない問題
- オンボーディングツールチップがナビゲーションバーに隠れる問題
- ペースト時にclipboard.readが空を返す際のフォールバック改善
- 履歴一覧で長いプロジェクトパスが折り返される問題

## [0.0.25] - 2026-02-05

### Added
- **CLI国際化対応**: バックエンド/CLIメッセージの日本語・英語対応
  - 環境変数 `LANG`/`LC_ALL`/`LC_MESSAGES` から言語を自動検出
  - 日本語ロケール (`ja_*`) → 日本語出力、それ以外 → 英語出力
  - シングルバイナリ対応のため翻訳データを埋め込み

### Changed
- CLAUDE.md に国際化（i18n）セクションを追加

## [0.0.24] - 2026-02-05

### Added
- **フロントエンド国際化対応**: react-i18nextによる完全なi18n対応
  - 全UIコンポーネントの日本語・英語翻訳
  - i18next-browser-languagedetectorによるブラウザ言語自動検出
  - 言語切替ボタン（EN/JA）をUIに追加
  - 設定は localStorage (`cchub-language`) に保存
  - 翻訳ファイル: `frontend/src/i18n/locales/{en,ja}.json`

### Changed
- ダッシュボードのステータスメッセージをフロントエンドで生成（翻訳対応）
- 全コンポーネントのハードコードされた日本語を翻訳キーに置換

## [0.0.23] - 2026-02-05

### Added
- **会話履歴の検索機能**
  - 履歴タブに検索ボックスを追加
  - プロジェクト名とユーザーメッセージで検索
  - インクリメンタルサーチ（SSEストリーミング）
  - 全文検索対応（全ユーザーメッセージを検索）
  - マッチ箇所のスニペット表示

## [0.0.22] - 2026-02-05

### Added
- **VSCode風ツリービューファイラー**
  - ディレクトリを展開/折りたたみで表示
  - サブディレクトリの遅延読み込み
  - 深さに応じたインデント表示

- **ファイラーのペインリサイズ機能**
  - 左右ペイン間のディバイダーをドラッグでリサイズ可能
  - マウス/タッチ両対応

- **テキスト選択機能**
  - Markdownプレビューでテキスト選択可能
  - 会話ビューアでテキスト選択可能

### Fixed
- 会話ビューアで画像が表示されない問題
  - 認証不要の画像エンドポイント `/api/images/` を追加
- HTMLプレビューの定期リフレッシュ問題
  - blob URLをメモ化してiframe再読み込みを防止
- ファイラー表示時にキーボードが前面に出る問題
  - キーボードのz-indexを調整
- デスクトップでの日本語IME入力が正しく動作しない問題

## [0.0.21] - 2026-02-05

### Added
- **セッション色テーマ機能**
  - セッションごとに色テーマを設定可能（9色 + なし）
  - セッション一覧で長押し → 色選択メニュー表示
  - ターミナル背景色がテーマに応じて変化
  - 設定は `~/.cchub/session-themes.json` に永続化

- **会話ビューアの改善**
  - システム生成サマリーを「System (Summary)」として区別表示
  - 琥珀色のスタイルで実際のユーザーメッセージと区別

### Changed
- **モバイルキーボード改善**
  - タップ/長押しでカスタムキーボードを表示
  - OSソフトキーボードの起動を防止
  - xterm内部textareaに`inputmode="none"`を設定

### Fixed
- モバイルでセッションテーマ変更が即座に反映されない問題

## [0.0.20] - 2026-02-05

### Added
- **パスワード認証機能**
  - `-P`オプションでサーバー起動時にパスワード認証を有効化
  - 全APIエンドポイントに条件付き認証ミドルウェアを適用
  - WebSocket接続時のトークン認証
  - フロントエンドにログインフォーム追加

- **HTMLファイルプレビュー**
  - ファイルビューアでHTMLファイルをiframeでプレビュー表示

- **開発用コマンド**
  - `bun run dev:auth` - パスワード認証付きで開発環境起動（パスワード: devpass）

### Security
- JWT認証によるAPIアクセス制御
- WebSocketトークン検証
- `authFetch`ヘルパーで認証付きAPI呼び出しを一元化

## [0.0.19] - 2026-02-04

### Added
- **PC版長押し削除対応**
  - デスクトップブラウザでセッション一覧の長押し削除が動作
  - `onMouseDown`/`onMouseUp`/`onMouseLeave`イベントを追加

### Changed
- **Claude Code検出の改善**
  - macOSとLinux両方で動作するTTYプロセスチェック方式を採用
  - `ps -t`コマンドで`claude`プロセスを直接確認
  - `pane_current_command`フォールバックを削除

### Fixed
- 未定義変数`pts`を`ttyName`に修正（セッションマッチングが失敗していた問題）

### UI
- PC版のアイコンボタンサイズを拡大（w-3 h-3 → w-4 h-4）
- ボタンのイベント伝播を修正

## [0.0.18] - 2026-02-04

### Added
- **ダッシュボードにバージョン表示**
  - CC Hubバージョンを画面下部に表示

### Changed
- **バージョン管理の改善**
  - package.jsonを正とするバージョン管理に変更
  - ハードコードされたVERSION定数を削除

### UI
- モバイル版の下部ナビゲーションバーの高さを増加（タッチターゲット改善）

## [0.0.4] - 2026-02-01

### Added
- **CLI強化**
  - `--help` / `--version` オプション
  - `-p, --port` / `-H, --host` / `-P, --password` オプション
  - `cchub setup` - systemdサービス登録コマンド
  - `cchub update` - 自動更新コマンド（GitHub Releases連携）
  - `cchub status` - サービス状態確認コマンド

- **systemd連携**
  - ユーザーサービスファイル自動生成
  - 自動再起動（Restart=always）
  - 毎日の自動更新チェック（timer）

### Changed
- Tailscale必須化（常にHTTPS）
- 環境変数からCLI引数ベースの設定に変更

### Removed
- 自己署名証明書機能（TLS=1）
- カスタム証明書機能（TLS_CERT/TLS_KEY）
- 環境変数による設定（PORT, HOST, TLS）

## [0.0.3] - 2026-02-01

### Added
- **Dashboard機能**
  - 使用量リミット表示（5時間/7日サイクル）
  - リミット到達予測（現在のペースでの予測時間）
  - 日別使用統計グラフ（メッセージ数・セッション数）
  - モデル別トークン使用量（Opus/Sonnet比較）
  - 推定コスト表示

- **セッション履歴機能**
  - 過去のClaude Codeセッション一覧
  - プロジェクト別グループ化
  - 会話内容の表示
  - セッション再開（`claude -r`）

- **会話ビューア強化**
  - Markdownレンダリング（テーブル、コードブロック対応）
  - 画像表示サポート
  - アクティブセッションの自動更新

- **セッション管理強化**
  - PTY-based session matching（同一ディレクトリでの複数セッション識別）
  - セッション状態インジケーター（処理中/入力待ち/アイドル/完了）
  - セッション再開ボタン

### Fixed
- 同じディレクトリで複数のClaude Codeセッション実行時に情報が混在する問題

## [0.0.2] - 2026-02-01

### Added
- GitHub Releaseへのバイナリ自動アップロード

## [0.0.1] - 2026-01-31

### Added
- 初期リリース
- マルチセッション管理
- タブレット最適化UI
- ファイルビューア
- 変更追跡
- TLS対応（自己署名証明書、Tailscale）
