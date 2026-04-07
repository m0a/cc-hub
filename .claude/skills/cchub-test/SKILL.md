---
name: cchub-test
description: CC Hub のブラウザテストを実行する。dev環境を起動し、agent-browser でUIを検証する。「/cchub-test」「テストして」「ブラウザテスト」などで起動。
---

# CC Hub Browser Test

CC Hub の tmux control mode 機能をブラウザで自動テストするスキル。

## Prerequisites

- dev環境が起動していること（ポート3000 + 5173）
- agent-browser が利用可能であること

## Test Workflow

### 1. 環境準備

```bash
# ポート確認
fuser 3000/tcp 2>/dev/null && echo "Backend OK" || echo "Backend NOT running"
fuser 5173/tcp 2>/dev/null && echo "Frontend OK" || echo "Frontend NOT running"

# 起動されていない場合
cd /home/m0a/cchub-work-1
fuser -k -9 3000/tcp 2>/dev/null; fuser -k -9 5173/tcp 2>/dev/null
sleep 1 && nohup bun run dev > /tmp/cchub-dev.log 2>&1 &
sleep 4
```

### 2. ブラウザ起動（オンボーディング自動スキップ）

```bash
agent-browser close 2>/dev/null
agent-browser --ignore-https-errors open "https://localhost:3000?skipOnboarding=true"
agent-browser wait 4000
```

`?skipOnboarding=true` クエリパラメータにより、オンボーディングが自動スキップされる。

### 4. テスト項目

#### 4-1. ターミナル表示確認
```bash
agent-browser screenshot
# 2ペインが表示されていること確認
```

#### 4-2. キーボード入力テスト
```bash
agent-browser snapshot -i
agent-browser click @e9   # Terminal input textbox (ref may vary)
agent-browser type @e9 "echo test"
agent-browser press Enter
agent-browser wait 2000
agent-browser screenshot
```

#### 4-3. ペイン分割テスト (Ctrl+D)
```bash
tmux list-panes -t <session> -F '#{pane_id} #{pane_width}x#{pane_height}'
agent-browser press Control+d  # 横分割
sleep 2
tmux list-panes -t <session> -F '#{pane_id} #{pane_width}x#{pane_height}'
agent-browser screenshot
```

#### 4-4. ペインリサイズ ショートカットテスト
```bash
echo "=== Before ===" && tmux list-panes -t <session> -F '#{pane_id} #{pane_width}x#{pane_height}'

# Ctrl+Shift+Right: 右に5カラム広げる
agent-browser press Control+Shift+ArrowRight
sleep 1
echo "=== After Right ===" && tmux list-panes -t <session> -F '#{pane_id} #{pane_width}x#{pane_height}'

# Ctrl+Shift+Left: 左に5カラム縮める
agent-browser press Control+Shift+ArrowLeft
sleep 1

# Ctrl+Shift+=: 均等化
agent-browser press Control+Shift+Equal
sleep 1
echo "=== After equalize ===" && tmux list-panes -t <session> -F '#{pane_id} #{pane_width}x#{pane_height}'
```

**注意**: headless ブラウザで `Ctrl+Alt+Arrow` は動作しないが `Ctrl+Shift+Arrow` は動作する。
JS dispatch でのテスト:
```bash
agent-browser eval "window.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', ctrlKey: true, shiftKey: true, bubbles: true})); 'ok'"
```

#### 4-5. ドラッグリサイズテスト

**重要**: 区切り線の位置はペインサイズに応じて変わるため、毎回動的に取得すること。

```bash
# 区切り線の中心座標を動的に取得
CENTER_X=$(agent-browser eval "(() => { const divs = document.querySelectorAll('[style*=\"position: relative\"]'); for (const d of divs) { if (d.className.includes('cursor-col-resize')) { const r = d.getBoundingClientRect(); return Math.round(r.left + r.width / 2); } } return -1; })()" | tr -d '"')

# ドラッグ実行（中心から左に150px移動）
agent-browser mouse move $CENTER_X 360 --steps 5
sleep 0.5
agent-browser mouse down
sleep 0.5
agent-browser mouse move $((CENTER_X - 150)) 360 --steps 20
sleep 0.3
agent-browser mouse up

# tmuxサイズ変更確認
sleep 3
tmux list-panes -t <session> -F '#{pane_id} #{pane_width}x#{pane_height}'
```

#### 4-6. リサイズ無限ループ確認
```bash
# 5秒待ってリサイズログを確認
sleep 5
tail -100 /tmp/cchub-dev.log | grep -c '\[Resize\]'
# 2-3回以内ならOK。10回以上なら無限ループ発生
```

#### 4-7. リロード後の維持確認
```bash
echo "=== Before reload ===" && tmux list-panes -t <session> -F '#{pane_id} #{pane_width}x#{pane_height}'
agent-browser open https://localhost:3000
agent-browser wait 5000
echo "=== After reload ===" && tmux list-panes -t <session> -F '#{pane_id} #{pane_width}x#{pane_height}'
# サイズが同じであること
```

### 5. クリーンアップ
```bash
agent-browser close
```

## Shortcuts Reference

| Shortcut | Action |
|----------|--------|
| Ctrl+D | 縦分割（右に新ペイン） |
| Ctrl+Shift+D | 横分割（下に新ペイン） |
| Ctrl+W | ペインを閉じる |
| Ctrl+Arrow | ペインフォーカス移動 |
| Ctrl+Shift+Arrow | ペインサイズ調整（±5/±3） |
| Ctrl+Shift+= | ペイン均等化 |
| Ctrl+B | セッション一覧トグル |
| Ctrl+C | コピー |
| Ctrl+V | ペースト |
| Ctrl+1-9 | セッション切替 |

## Log Locations

- Dev server log: `/tmp/cchub-dev.log`
- Frontend log (remote): `tail -f logs/frontend.log` (from cchub-work-1 dir)
- Resize events: `grep '\[Resize\]' /tmp/cchub-dev.log`
