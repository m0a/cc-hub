#!/usr/bin/env bash
# CC Hub TUI 開発ハーネス — リリースせずにソースからサイドバーレイアウトを試す。
#
# 専用 tmux ソケット（cchub-dev）に「左=サイドバー / 右=作業ペイン」を立ち上げ、
# サイドバーはソース（bun run tui/src/index.ts --sidebar）で起動する。
# CCHUB_SIDEBAR_CMD をソケットの env に載せるので、切替えで開く子サイドバーもソースになる。
#
# 使い方:  bun run dev:tui-live   (= このスクリプト)  /  引数でポート:  scripts/dev-tui.sh 5923
# セッション一覧のデータは稼働中の CC Hub サーバ（既定 5923）から取得する。
# 注意: dev ソケットは実セッションとは分離。クリックでの実切替えは no-op（UI/レイアウト検証用）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-5923}"
SOCK="cchub-dev"
INDEX="$ROOT/tui/src/index.ts"
CMD="bun run $INDEX --sidebar -p $PORT"

# 子ペイン（tmux が開くサイドバー）もソース起動になるよう env に載せる。
export CCHUB_SIDEBAR_CMD="$CMD"

# 既存の dev ソケットを畳んでやり直す。
tmux -L "$SOCK" kill-server 2>/dev/null || true

# 右=作業ペイン（ただのシェル）。サーバの env を引き継ぐので CCHUB_SIDEBAR_CMD も乗る。
tmux -L "$SOCK" new-session -d -s dev -x 200 -y 50
tmux -L "$SOCK" set -g mouse on
tmux -L "$SOCK" set -g status-right " cchub tui dev (source) · q=閉じる "

# 左=サイドバー（ソース起動）。
tmux -L "$SOCK" split-window -h -b -l 34 -t dev "$CMD"

echo "cchub tui dev: 左サイドバーはソース起動。編集して再実行で反映。ソケット: $SOCK"
tmux -L "$SOCK" attach -t dev
