# PoC: herdr を tmux の代替バックエンドにできるか

検証日: 2026-07-14 / herdr v0.7.3 (protocol 16) / Arch Linux

## 結論（実装済み — 同ブランチに CCHUB_MUX=herdr 暫定バックエンドあり）

**成立する。Claude Code 実セッションで dev 検証済み**（TUI描画・入力ボックス
カーソル・日本語プロンプト往復・hook indicator・ccSessionId 紐付け・分割・
scrollback・クローズ）。残る制約は「深い scrollback」の 1000 行 API キャップのみで、
herdr 側の機能追加（pane.read の offset 対応 or キャップ緩和）待ち。

### 実装で確定したアーキテクチャ (v2)

ペインごとに `herdr terminal session control` を常駐させ、単一ストリームに統合:
- 入力: `{"type":"terminal.input","bytes":"<base64>"}` — **raw パススルー**
  （`pane.send_input` RPC は text 中の改行/ESC を落とすため使わない。
  マウスSGR・bracketed paste もそのまま届く。順序は stdin パイプが保証）
- リサイズ: `{"type":"terminal.resize","cols":N,"rows":N}` — ペイン単位の絶対サイズ
  （headless では herdr グリッドが不変のため、レイアウトは CC Hub 自前の split 木）
- 出力: stdout の terminal.frame (base64 ANSI) を viewport 再取得のトリガに使い、
  フレーム末尾の CUP/?25h/l と 1049h/l 遷移から**カーソル位置と alt-screen を追跡**
  （アタッチ前から alt の場合はフレームに遷移が出ないため、
  「非シェル前面プロセス && host scrollback 0」で初期推定）
- agent 検出: `pane.process_info` の foreground_processes を全走査
  （先頭が group leader = claude、以降は子の MCP サーバ）

## 検証環境の再現

```bash
# インストール（GitHub releases から単一バイナリ）
gh release download v0.7.3 --repo ogulcancelik/herdr --pattern 'herdr-linux-x86_64'
install -m755 herdr-linux-x86_64 ~/.local/bin/herdr

# ヘッドレスサーバ起動（TUI 不要）
herdr server &        # socket: ~/.config/herdr/herdr.sock
herdr status server

# 検証用ペイン
herdr workspace create --cwd ~     # → w1 / w1:t1 / w1:p1
bun run poc/herdr/poc-client.ts w1:p1
```

## 検証結果マトリクス

| CC Hub の tmux 依存機能 | herdr での代替 | 結果 |
|---|---|---|
| `-CC` 制御モード (`%output` push) | `herdr terminal session observe <target>` → NDJSON `terminal.frame`（base64 ANSI バイト列、`full` フラグで全再描画/差分を区別、`--cols/--rows` 指定可） | ✅ 実測 OK。xterm.js にそのまま `term.write()` できる形式 |
| `capture-pane -e`（ANSI 付き viewport） | `pane.read {source:"visible"/"recent", format:"ansi"}` | ✅ SGR 保持（256色形式に正規化される: `\e[31m` → `\e[38;5;1m`） |
| scrollback 任意 offset ページング | `pane.read {source:"recent", lines: offset+rows}` → 末尾スライス | ⚠️ **1000 行ハードキャップ**（lines=50000 でも 1001 行）。offset+rows ≤ 1000 の範囲のみ成立 |
| scrollback 保持量 | `[advanced] scrollback_limit_bytes`（既定 10MB ≒ 実測 14,441 行） | ✅ 保持はされるが API から届かない（上記キャップ） |
| `send-keys -H`（UTF-8 安全な入力） | `pane.send_text` / `pane.send_keys`（JSON なのでバイト分断問題が構造的に消滅） | ✅ 日本語・絵文字 round-trip 実測 OK |
| layout 文字列パース (`TmuxLayoutParser`) | `pane.layout` → 構造化 JSON（rect / splits / ratio / zoomed） | ✅ パーサ自体が不要になる |
| octal デコード (`TmuxOctalDecoder`) | 不要（observe は base64、read は UTF-8 JSON） | ✅ サービスごと削除可能 |
| split / close / focus / resize / zoom / respawn | `pane.split/close/focus/resize/zoom` + `agent.start` | ✅ CLI・socket 両対応 |
| クライアントサイズ同期 (`setClientSize`) | `terminal session control/observe --cols N --rows N` | ✅ 観測時にサイズ指定可 |
| copy-mode 選択 | 相当機能なし | ❌ CC Hub 側の SelectionOverlay（フロント選択）で代替可能 |
| カーソル位置 (`PaneCursor`) | `pane.read` はカーソル情報を**返さない**。observe フレームには CUP が含まれる | ⚠️ read ベース viewport 合成ではカーソル欠落。observe 直流しなら問題なし |
| hook ベースのエージェント状態 | `pane.agent_status_changed` 購読（working/blocked/done/idle をネイティブ検知）+ `agent.list` | ✅ 独自インジケータ機構の大部分を置換できる可能性 |
| 再起動後の復旧 (last-known-sessions) | `[experimental] pane_history` + `[session] resume_agents_on_restore`（エージェントのネイティブセッション再開） | ✅ むしろ herdr の方が高機能 |

## socket API の実装上の注意（実測）

- プロトコルは **NDJSON over Unix socket**（`~/.config/herdr/herdr.sock`）
- **1 リクエスト = 1 接続**。応答後にサーバが切断する（`events.subscribe` のみ接続維持で push が流れる）
- `pane.read` の応答は `result.read.text` にネスト
- 1000 行読み出しで ~8ms、レスポンスは高速
- `herdr terminal session observe` は CLI サブプロセスとして起動し stdout の NDJSON を読む形
  （tmux -CC サブプロセスと同じ構造。socket API のメソッドとしては未公開）

## アーキテクチャ案（移行する場合)

```
Browser <--WS (/ws/mux)--> Hono Server <--NDJSON socket + observe subprocess--> herdr server <--PTY--> Claude Code
```

- `TmuxControlSession` → `HerdrControlSession`（observe subprocess の NDJSON を読む。octal デコード不要）
- `PaneViewport` 合成 → `pane.get`(scroll) + `pane.read`(ansi) で組み立て（poc-client.ts の `captureViewport` 参照）
- `TmuxLayoutParser` / `TmuxOctalDecoder` → 削除
- HookStatusService → `pane.agent_status_changed` 購読に段階的統合

## ブロッカーと対応方針

1. **pane.read の 1000 行キャップ**（最重要）
   - upstream に offset パラメータ or キャップ設定化の feature request を出す
     （herdr はフルタイム開発・リリース頻度高、見込みあり）
   - 代替案: observe フレームをサーバ側で蓄積して独自履歴を持つ
     （= 端末エミュレータの再実装に近く、重い。非推奨）
   - 暫定運用: Web UI の scrollback を 1000 行に制限（実用上は十分な場面が多い）
2. **カーソル位置**: read ベース合成では欠落。observe フレーム直流しへの
   レンダリング設計変更（viewport-render.ts の役割縮小）とセットで検討
3. **プロトコル安定性**: v0.7.x / protocol 16。1.0 前はバージョン固定 +
   `herdr status server` の protocol チェックを起動時に行う

## 検証ログ

- PoC クライアント: `poc/herdr/poc-client.ts`（Bun から全経路実証済み、exit 0）
- 生データ: scratchpad に read-*.txt / observe.ndjson / herdr-schema.json
