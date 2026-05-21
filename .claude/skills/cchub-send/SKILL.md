---
name: cchub-send
description: CC Hub の `cchub send` で、ローカル or peer サーバの tmux パネルにテキスト/コマンドを送信する。「/cchub-send」「ペインに送って」「セッションに入力」「peerに送信」「リモートセッションに送って」などで起動する。
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
- `<session>`: tmux セッション名 (= cchub の session id)
- `<paneId>`: tmux pane id (例: `%7`)

## 基本コマンド

```bash
# 引数で text を渡す（純粋に bytes だけ送る）
cchub send local:my-session:%5 "hello"

# Enter (CR) を末尾に付ける — シェルや TUI でコマンドを実行させたいときに必須
cchub send local:my-session:%5 "ls -la" --newline

# stdin から payload を流し込む
echo "echo from stdin" | cchub send local:my-session:%5 --stdin --newline
cat script.sh | cchub send local:my-session:%5 --stdin

# peer (nickname or id) に送る
cchub send 🏠Studio:cc-hub:%2 "echo ping" --newline
cchub send p_a1b2c3d4:my-session:%5 "echo ping" --newline

# バイナリ/制御文字を送る場合は base64
printf '\x03' | base64 | cchub send local:my-session:%5 --stdin --base64   # Ctrl+C
```

## 送信先の paneId を調べる

```bash
# ローカル
curl -sk https://localhost:5923/api/sessions \
  | python3 -c "import json,sys; [print(f\"{s['name']}: {[p['paneId'] for p in s.get('panes',[])]}\") for s in json.load(sys.stdin)['sessions']]"

# 認証付きの場合 (token は peers.json から取得)
TOKEN=$(python3 -c "import json; print(json.load(open('$HOME/.cc-hub/peers.json'))['peers'][0].get('wsToken',''))")
curl -sk -H "Authorization: Bearer $TOKEN" https://<peer-host>:5923/api/sessions
```

## 注意

- `cchub send` はデフォルトで `-p 5923` (本番ポート) を見にいく。dev サーバ (3456) に送りたいときは `-p 3456` を付ける
- `--newline` を忘れるとシェルに入力されてもコマンドが実行されない (画面に文字列だけが残る)
- peer の paneId はその peer の tmux サーバから見た id なので、ローカルで `tmux list-panes` しても出てこない。peer の `/api/sessions` を叩いて確認すること
- `peers.json` は `~/.cc-hub/peers.json` (`CC_HUB_DATA_DIR` で上書き可)。CLI は peer-registry 経由で読むので環境変数があれば自動で従う

## トラブルシュート

| 症状 | 原因 | 対処 |
|------|------|------|
| `target は <peer>:<session>:<paneId> 形式で指定してください` | コロン区切りが3つ揃っていない | `<peer>:<session>:<paneId>` に直す |
| `peer "<name>" が見つかりません` | nickname/id 不一致 | UI の Settings → Peers で確認 |
| `HTTP 404 Pane not found` | paneId がそのセッションに存在しない | `GET /api/sessions` で再確認 |
| `HTTP 404 Session not found` | tmux に session 自体が無い | `tmux ls` または UI で確認 |
| `HTTP 401` | peer の token 期限切れ/不正 | UI で peer を作り直して再ログイン |
| `peer に接続できません` | peer の URL/port 違い、サーバ停止 | URL と起動状態を確認 |

## 実装

- CLI: `backend/src/commands/send.ts` (`runSend`)
- HTTP: `backend/src/routes/sessions.ts` の `POST /:id/panes/input`
- スキーマ: `PaneInputSchema` (`paneId`, `data`, `encoding: 'utf-8' | 'base64'`)
- 内部的には `TmuxControlSession.sendInput(paneId, Buffer)` を呼ぶ (xterm からのキー入力と同じ経路)
