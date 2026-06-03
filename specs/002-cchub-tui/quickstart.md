# Quickstart: CC Hub TUI

## 前提

- CC Hub サーバが同一マシンで稼働していること（本番 `cchub`=5923、dev は backend=3456）。
- tmux がインストール済みでアクセス可能。
- Bun（既存ワークスペースと同一）。

## 開発

```bash
# 1. dev サーバ起動（$TMUX ネスト時は env -u TMUX が必要 / CLAUDE.md 既知）
nohup env -u TMUX bun run dev > /tmp/cchub-dev.log 2>&1 &

# 2. TUI を dev サーバ（3456）に向けて起動
bun run --filter tui dev -- --port 3456
#   or 実体: cd tui && bun run src/index.tsx --port 3456
```

## 本番

```bash
cchub tui            # 5923 のローカルサーバに接続
cchub tui -p 8080    # カスタムポート
```

## 着手前スパイク（必須・R3）

実装本体の前に、Ink × Bun の互換を1本で確認する:

1. Ink でキー入力を受領できる（raw-mode）。
2. `Enter` で alt-screen/raw-mode を解除し、`tmux attach` 相当の子プロセスを stdio 継承で起動できる。
3. 子プロセス終了後に Ink が復帰して再描画できる。
4. `$TMUX` セット環境で `switch-client` / `env -u TMUX` 経路が機能する。

これが通ればコア前提（ハンドオフ）が成立。通らなければ描画方式を再検討。

## 動作確認（受け入れ確認の手動手順）

- **P1**: 複数セッション稼働状態で起動 → 一覧に agent/state/cwd/title/pane 数が出る（SC-001 < 3s）。状態を変化させ 5s 以内に反映（SC-002）。`Enter` で入室 → 離脱で一覧復帰、内容保持（SC-005）。
- **P2**: `/` で検索 → キーワード入力で逐次結果（SC-004 < 2s）→ `Enter` で resume → 入室。
- **P3**: `n` で作成（agent+dir）→ 一覧に出現。`x` で終了 → 消える。`r` で resume。
- **異常系**: サーバ停止状態で起動 → 起動案内（FR-012）。tmux セッション内から起動 → 入室成功（SC-007 / FR-013）。

## テスト

```bash
bun run --filter tui test     # 単体（TDD: auth/client/attach 構築/$TMUX 検知/整形）
bun run test                  # 全ワークスペース
bun run lint                  # Biome
```

## 完了の定義（v1）

- P1/P2/P3 の受け入れシナリオが手動で通る。
- 純粋ロジックの単体テストがカバレッジ 80% を満たす（憲章 原則I）。
- `cchub tui` が本番バイナリから起動できる（`build:binary` 通過）。
