---
name: cchub-send
description: CC Hub の `cchub send` で、ローカル or peer サーバのターミナルペイン (herdr) にテキスト/コマンドを送信する。「/cchub-send」「ペインに送って」「セッションに入力」「peerに送信」「リモートセッションに送って」などで起動する。
---

# cchub-send

別の CC Hub サーバ (peer) や自分自身のセッションのパネルに、CLI からテキストを送り込むためのスキル。

`POST /api/sessions/:id/panes/input` を叩く `cchub send` サブコマンドを使う。

## 前提

- 送信先サーバ (local もしくは peer) で `cchub` が動いている (デフォルト 5923)
- peer に送る場合は `peers.json` に peer が登録済み (UI で追加するか peer-registry が生成済み)
- peer 認証がある場合は登録時に bearer token が `peers.json` に保存されている

## ターゲット指定

`<peer>:<session>:<paneId>` の3パート構成。

- `<peer>`: `local` / `self` / peer id (`p_xxxx`) / peer の nickname
- `<session>`: cchub の session id (= herdr workspace のラベル)
- `<paneId>`: pane id (tmux 形式 `%N`, 例: `%7`)

## 基本コマンド

```bash
# 引数で text を渡す（純粋に bytes だけ送る）
cchub send local:my-session:%5 "hello"

# Enter (CR) を末尾に付ける — シェルや TUI でコマンドを実行させたいときに必須
cchub send local:my-session:%5 "ls -la" --newline

# Claude Code TUI に送って submit させる (paste mode を抜けるため CR を2回付与)
cchub send local:my-session:%5 "プロンプト本文" --submit

# stdin から payload を流し込む
echo "echo from stdin" | cchub send local:my-session:%5 --stdin --newline
cat script.sh | cchub send local:my-session:%5 --stdin

# peer (nickname or id) に送る
cchub send 🏠Studio:cc-hub:%2 "echo ping" --newline
cchub send p_a1b2c3d4:my-session:%5 "echo ping" --newline

# バイナリ/制御文字を送る場合は base64
printf '\x03' | base64 | cchub send local:my-session:%5 --stdin --base64   # Ctrl+C
```

## フラグ

| フラグ | 末尾に追加 | 用途 |
|--------|-----------|------|
| (なし) | -- | 純粋にバイト列だけ送る (画面に表示するだけ等) |
| `--newline` | `\r` 1回 | シェル/通常 TUI で Enter 相当 |
| `--submit` | `\x1b[200~…\x1b[201~\r` | **Claude Code / Codex TUI 専用** — bracketed paste でラップ + Enter。長さ無関係に submit される (v0.1.158 以降) |
| `--stdin` | -- | 引数の代わりに stdin から payload を読む |
| `--base64` | -- | payload は base64 文字列扱い (制御文字/バイナリを送る用) |
| `--wait` | -- | 送信後に peer の pane viewport を取得して stdout に出す (色付き)。`detectedState` も併記される |
| `--wait-ms <N>` | -- | `--wait` のスナップショット待ち時間 (ms, default 800)。Claude TUI の再描画完了を待つ |
| `--lines <N>` | -- | viewport で返す末尾行数 (default 20) |

## 状態を見る — `cchub peek` と `cchub send --wait`

「送ったけど相手どうなってる？」を **UI を開かずに** 確認するための仕組み。`/api/sessions/:id/panes/:paneId/viewport` を叩いて pane の最新画面を取得し、内蔵ヒューリスティクスで状態を判定する。

```bash
# 送信せず現状だけ覗く
cchub peek 🏠Studio:cc-hub:%6 --lines 15

# 送って返事を待たずに、その直後の peer 画面を見る
cchub send 🏠Studio:cc-hub:%6 "ステータス報告" --submit --wait
cchub send 🏠Studio:cc-hub:%6 "巨大プロンプト" --submit --wait --wait-ms 1500 --lines 30
```

返値の `detectedState` は次のいずれか:

| state | 意味 | 対処 |
|-------|------|------|
| `idle` | プロンプト待機中 (`✻/✳` マーカー or 空入力箱) | 送信OK |
| `processing` | ツール実行中 (`(esc to interrupt)` / `· Verb… (… tokens …)` スピナー) | 完了を待つ |
| `permission_prompt` | 権限ダイアログ表示中 (`Do you want to ...?`, `Yes, and don't ask again`) | **追加で `cchub send` しても飲まれない**。peer 側で承認するか、`Bash(cchub send:*)` 等を事前許可しておくこと |
| `ask_user_question` | `AskUserQuestion` の番号選択待ち | 番号 (`1`/`2`/...) を `--newline` で送る |
| `unknown` | 上記いずれも当てはまらず | 念のため `cchub peek --lines 30` で生画面を確認 |

⚠️ 判定はあくまで viewport 文字列パターンマッチ。Claude Code TUI の表記が変わると外れる可能性あり (`backend/src/services/pane-viewport.ts` の `detectPaneState`)。判定が `unknown` でも実際の画面 (`text` フィールド or 色付き出力) は信頼できる。

### `cchub peek` の出力フォーマット

stdout と stderr を意図的に分けてる:

```
[stderr] ── <peer>:<session>:<paneId> (cols x rows) — <icon> <detectedState>
[stdout] <ANSI escape 込みの viewport 行群>
[stdout] ...
[stderr] ── end ─ cursor (x,y)
```

- **detectedState はヘッダ行 (1 行目, stderr) の末尾** に出る。`✳ idle` / `⏳ processing` / `⚠️ permission_prompt` 等。**ここを最初に見る**
- viewport 本文は **ANSI escape を保持したまま** stdout に流れる。色は付くが grep / jq には不向き
- パイプ処理したい時は viewport endpoint を直接叩く: `curl -sk https://<host>:5923/api/sessions/<id>/panes/<paneId>/viewport?lines=20 -o /tmp/v.json && jq -r '.detectedState, .text' /tmp/v.json`
- `--lines 0` で全 viewport を取得 (default 20)

## 双方向で対話する (peer から返事させる)

「こちらから送る」だけでなく、相手側の Claude Code に **`cchub send` で返事させる** ことで両端 Claude Code 同士の対話が成立する。

### セットアップ

1. **両方の peers.json にお互いを登録**:
   ```bash
   # A 側で B を登録 (UI からでも CLI からでも)
   curl -sk -X POST https://<B-host>:5923/api/peers \
     -H 'Content-Type: application/json' \
     -d '{"nickname":"🅱 B","url":"https://<A から見た B の URL>"}'

   # B 側で A を登録 (B から見える A の Tailscale ホスト名を使う)
   curl -sk -X POST https://<A-host>:5923/api/peers \
     -H 'Content-Type: application/json' \
     -d '{"nickname":"🅰 A","url":"https://<B から見た A の URL>"}'
   ```
   peer のパスワードが無ければ token は空のまま登録できる。

2. **返信側で `cchub send` の Bash permission を事前許可** ⚠️ **これを忘れると返事できない**:
   返信側 Claude Code が `cchub send` を実行する瞬間 Bash permission prompt で停止する。`/api/sessions` の indicatorState は遅延更新なので「動いてる」ように見えてしまい、ハマる。事前に許可しておく:
   - 返信側セッションの `.claude/settings.local.json` に `"permissions": { "allow": ["Bash(cchub send:*)"] }` を追加
   - もしくは返信側 Claude Code を `--dangerously-skip-permissions` で起動
   - もしくは初回のみ手動で承認: 相手側 UI を開き、permission prompt で「**Yes, and don't ask again for: cchub send**」を選ぶ。これで以降は止まらない

3. **自分の pane を特定**:
   ```bash
   curl -sk https://localhost:5923/api/sessions | jq -r '.sessions[] | select(.state!="lost") | .id'   # session 一覧
   ```

4. **送信時に返信先と返し方を明記**:
   ```bash
   cchub send mac:cc-hub:%6 "ステータス報告をお願いします。返信は cchub send '🅰 A:cchub-work-1:%1' '<本文>' --submit で戻してください。完了後 [reply-done] を別送" --submit
   ```

### コツ

- 返信先の peer 指定は **A 側に登録した nickname / id** を使う (B 側の peers.json での名前)。両端で名前が違っていてOK
- 返信は `--submit` を使うよう明示。`--newline` 1回だと長文では submit されない
- 返事が複数ターン続く場合に備えて、終了マーカー (`[reply-done]` 等) を最後に別送するよう指示すると追跡しやすい (※実際には相手の Claude Code が本文末尾に連結して1回の send で済ませてくることが多いので、マーカーは本文末尾でも追跡可能な文字列にしておく)
- 受信側 (= こちらの pane) に返事が届くと、それは「ユーザーからの新しい入力」として Claude Code TUI に流し込まれる。すなわち相手の応答が次のターンのプロンプトになる
- **届いた返事が submit されないまま入力欄に溜まることがある** (相手側で `--submit` が抜けた / 古い cchub バイナリ)。追い打ちで `cchub send <target> "" --submit` を送ると確定する
- ✅ **v0.1.158 以降: `--submit` は bracketed paste でラップして送るので長さ無関係に submit される**。`\r\r` 末尾追加だった ~v0.1.157 までは ~300 bytes 以上の payload が paste 内に吸収されて入力欄に溜まる事故が出ていたが、根本対応済み。古い cchub と通信する場合 (相手側 cchub が v0.1.157 以下) は依然として長文で submit が吸収される可能性があるので、念のため `--wait` で viewport 確認すると安全

### デバッグ: 「届いてるのか?」を確かめる

`/api/sessions` の `indicatorState` / `waitingToolName` は hook 駆動で**反応が遅れる/止まることがある**。送ったテキストが相手に届いたか、submit されたか、permission で止まってないかを正しく判断するには:

- **`cchub send --wait` / `cchub peek` を使う** — viewport 取得 + 状態判定が一発で返るので、UI を開かなくても「届いてる/止まってる」が分かる (推奨)
- それでも判定が怪しいときは **peer の UI を実際に開いて目視確認**
- `indicatorState=completed` + `waitingToolName=UserInput` を「idle」と判断するのは危険。permission prompt 中も同じ表示になる可能性あり
- 返信側に「処理開始 / 終了マーカー」を別送させる ⇒ 相手側 Claude Code が動いてる証拠になる

### peer の hook 設定を診断する

`/api/sessions` の `indicatorState` が常に `completed/UserInput` で動かない場合、相手側で **hook が `cchub notify` を呼んでいない** 可能性が高い。次のエンドポイントで peer 側の hook 登録状態を取得できる:

```bash
curl -sk https://<peer-host>:5923/api/notify/hook-status | python3 -m json.tool
```

レスポンスの `missing` 配列に欠けてる hook event が並ぶ:
- `stop` — 応答完了が検知できない (常に processing のまま)
- `preToolUse` — **ツール実行中の processing 状態にならない** (今回ハマったやつ)
- `userPromptSubmit` — プロンプト送信が検知できない
- `askUserQuestion` — AskUserQuestion 待ちが検知できない

`missing` を埋めるには相手の `~/.claude/settings.json` に該当 hook を追加する:

```json
{
  "hooks": {
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "cchub notify" }] }],
    "Stop":       [{ "hooks": [{ "type": "command", "command": "cchub notify" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "cchub notify" }] }],
    "PostToolUse": [{ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "cchub notify" }] }]
  }
}
```

> 💡 受信側 (Mac の `/api/notify`) の動作確認は、適当な session_id を投げて直接叩けば一発:
> ```bash
> curl -sk -X POST https://<peer-host>:5923/api/notify -H "Content-Type: application/json" \
>   -d '{"session_id":"<ccSessionId>","hook_event_name":"PreToolUse","tool_name":"Bash"}'
> ```
> indicator が変化すれば受信側 OK、変化しなければ Claude Code 側 (= hook 設定) が問題

## 送信先の paneId を調べる

```bash
# ローカル
curl -sk https://localhost:5923/api/sessions \
  | python3 -c "import json,sys; [print(f\"{s['name']}: {[p['paneId'] for p in s.get('panes',[])]}\") for s in json.load(sys.stdin)['sessions']]"

# 認証付きの場合 (token は peers.json から取得)
TOKEN=$(python3 -c "import json; print(json.load(open('$HOME/.cc-hub/peers.json'))['peers'][0].get('wsToken',''))")
curl -sk -H "Authorization: Bearer $TOKEN" https://<peer-host>:5923/api/sessions
```

> ⚠️ **rtk 環境下では `curl | python3` が壊れる**: rtk が長い stdout を truncate して末尾に `[full output: ~/.local/share/rtk/tee/<id>_curl.log]` を追記するため、JSON が中途半端で `json.load` がエラーになる。回避策:
> ```bash
> # (a) tee log を直接読む — rtk が出力した path をそのまま使う
> curl -sk https://localhost:5923/api/sessions  # → "[full output: <log_path>]"
> cat <log_path> | jq -r '.sessions[] | "\(.id): \(.panes | map(.paneId) | join(","))"'
>
> # (b) rtk バイパス
> rtk proxy curl -sk https://localhost:5923/api/sessions | jq .
>
> # (c) 一旦ファイルに落とす (`-o`)
> curl -sk https://localhost:5923/api/sessions -o /tmp/sess.json && jq -r '.sessions[] | "\(.id): \(.panes | map(.paneId) | join(","))"' /tmp/sess.json
> ```
> 一番素直なのは (c)。長い API レスポンスを扱うとき汎用的に使える。

## TUI overlay を dismiss する (rating dialog 等)

Claude Code は不定期に `How is Claude doing this session? 1:Bad 2:Fine 3:Good 0:Dismiss` のようなフィードバック overlay を出す。これが出てる pane に `cchub send "プロンプト" --submit` を送っても overlay が先に keystroke を吸うので本文が届かない。先に overlay を畳む必要がある:

```bash
# 1) Esc を送る (\x1b = 1 byte) — overlay の標準的な閉じ方
printf '\x1b' | base64 | cchub send <target> --stdin --base64

# 2) 数字キーだけを送る (改行なし) — "0: Dismiss" 系
cchub send <target> "0"   # --newline / --submit は付けない、生の "0" だけ

# 3) Ctrl+C (\x03) — 強制リセット
printf '\x03' | base64 | cchub send <target> --stdin --base64
```

⚠️ `cchub send <target> "0" --newline` は **動かない** ことが実機確認済み。overlay は menu モードで raw keypress を待つので、`0\r` だと "0" → Enter という 2 操作扱いになり menu の選択ロジックに乗らないことがある。生 `"0"` か Esc を試す。

dismiss できたかは `cchub peek <target>` で確認 (`detectedState` が `idle` に戻れば OK)。

## 注意

- `cchub send` はデフォルトで `-p 5923` (本番ポート) を見にいく。dev サーバ (3456) に送りたいときは `-p 3456` を付ける
- `--newline` を忘れるとシェルに入力されてもコマンドが実行されない (画面に文字列だけが残る)
- **Claude Code / Codex TUI に送るときは `--submit`** を使う。v0.1.158 以降は bracketed paste markers (`\x1b[200~…\x1b[201~\r`) でラップするので、長さ無関係に確実に submit される。`--newline` (CR 1回) は shell コマンド実行用 — TUI に送ると multi-line として扱われ submit されない
- peer の paneId はその peer から見た id。peer の `/api/sessions` を叩いて確認すること
- `peers.json` は `~/.cc-hub/peers.json` (`CC_HUB_DATA_DIR` で上書き可)。CLI は peer-registry 経由で読むので環境変数があれば自動で従う

## トラブルシュート

| 症状 | 原因 | 対処 |
|------|------|------|
| `target は <peer>:<session>:<paneId> 形式で指定してください` | コロン区切りが3つ揃っていない | `<peer>:<session>:<paneId>` に直す |
| `peer "<name>" が見つかりません` | nickname/id 不一致 | UI の Settings → Peers で確認 |
| `HTTP 404 Pane not found` | paneId がそのセッションに存在しない | `GET /api/sessions` で再確認 |
| `HTTP 404 Session not found` | session (herdr workspace) 自体が無い | `herdr workspace list` または UI で確認 |
| `HTTP 401` | peer の token 期限切れ/不正 | UI で peer を作り直して再ログイン |
| `peer に接続できません` | peer の URL/port 違い、サーバ停止 | URL と起動状態を確認 |
| 文字列は届くが Claude Code が応答しない | submit されていない | `--submit` を付ける (bracketed paste でラップ + Enter) |
| `--newline` だと長文で submit されない | CR 1回だと paste mode の改行扱い | `--newline` を `--submit` に置き換える |
| `--submit` 付きでも payload が submit されない (入力欄に残る) | 相手の cchub が v0.1.157 以下で長文 `\r\r` 吸収バグ持ち、または相手側で `--submit` が抜けた | 相手側 cchub を v0.1.158 以上に更新。それでも残ってたら追い打ちで `cchub send <target> "" --submit` |
| 相手から返事が来ない | 相手側 peers.json にこちらが未登録 / 名前ミス | 相手側 `POST /api/peers` で登録、返信指示文に正確な nickname/id を書く |
| プロンプト送ったのに画面に出ない / Claude が反応しない | rating/feedback overlay が出てて keystroke を吸収中 | `cchub peek` で overlay 確認 → 「TUI overlay を dismiss する」セクションの手順で畳む |
| `cchub send "0" --newline` で overlay が dismiss できない | overlay は menu モードで raw keypress を待つので `0\r` が乗らない | 生 `"0"` (`--newline` なし) か `printf '\x1b' | base64 \| cchub send --stdin --base64` (Esc) |
| **相手の Claude Code が `cchub send` を実行しない** | Bash permission prompt で停止 | 返信側に `Bash(cchub send:*)` を事前許可 (settings.local.json or `--dangerously-skip-permissions`) |
| `indicatorState` 上は idle なのに submit が効いてない | hook 状態の遅延 / permission prompt 中も idle 表示 | UI を目視確認、または相手に「開始マーカーを別送」させる |

## 実装

- CLI: `backend/src/commands/send.ts` (`runSend`)
- HTTP: `backend/src/routes/sessions.ts` の `POST /:id/panes/input`
- スキーマ: `PaneInputSchema` (`paneId`, `data`, `encoding: 'utf-8' | 'base64'`)
- 内部的には `TmuxControlSession.sendInput(paneId, Buffer)` を呼ぶ (xterm からのキー入力と同じ経路)
