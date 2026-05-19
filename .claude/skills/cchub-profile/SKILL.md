---
name: cchub-profile
description: CC Hub 本番サービスの Bun inspector を一時的に on にして、Chrome DevTools で CPU プロファイル / heap snapshot を取得するためのスキル。「CPUが高い」「プロファイル取って」「flame chart 見たい」「inspect modeで見たい」「heap snapshot 取って」「JS関数レベルでホットスポット調べて」などのリクエストで起動する。アイドル時はオーバーヘッドゼロで、必要な時だけ inspector を開いて閉じる運用。
---

# cchub-profile

## 起動条件

`cchub.service` が systemd-user 上で稼働している前提。Linux 限定 (macOS launchd は未対応)。`cchub --version` が `v0.1.127` 以上。

## 基本コマンド

```bash
cchub debug profile --seconds N   # N 秒だけ inspector を開いて自動 disable
cchub debug enable                 # 開けっぱなしモード (手動 disable 必要)
cchub debug disable                # 通常モードへ戻す
cchub debug status                 # 現在の状態
```

## デフォルトのフロー (短時間の CPU profile)

1. `cchub debug status` で現状確認 (既に有効なら手順スキップ)
2. `cchub debug profile --seconds 60` を起動 (60 秒の窓を開ける)
3. journal から WS URL を確認:
   ```bash
   journalctl --user -u cchub.service --since "1 minute ago" --no-pager | grep "debug.bun.sh"
   ```
   出力例: `https://debug.bun.sh/#0.0.0.0:9229/<token>`
4. ユーザーに以下を案内 (ローカル Chrome で手作業):
   - Chrome で `chrome://inspect` を開く
   - **Configure…** → `<TAILSCALE_IP>:9229` (例: `100.91.210.90:9229`) を追加
   - Remote Target に **cchub** が出る → **inspect** クリック
   - Performance タブ → **Record** → 再現操作 → **Stop**
   - 右クリック → **Save profile** で `.cpuprofile` を保存 (Chrome DevTools / VS Code で開ける)
5. 60 秒経過で自動的に `disable` 実行され通常モードへ戻る
6. 戻ったことを `cchub debug status` で確認

## 開けっぱなしモード

長く調査したい場合:

```bash
cchub debug enable
# … 調査 …
cchub debug disable    # 必ず手動で戻すこと
```

`cchub debug status` が `🟢 Inspector enabled` のままなら忘れているサイン。必ず元に戻す。

## Claude 側で UI 状態を確認する場合 (オプション)

`agent-browser` が使えるなら、`https://debug.bun.sh/#0.0.0.0:9229/<token>` を開いて Console / Sources / Timelines タブの存在を確認できる。

**ただし agent-browser (headless Chromium) では Timeline のイベント列が空になる**: HTTPS の `debug.bun.sh` から `ws://` への mixed-content や WebSocket 接続まわりの制約で、UI は表示できるが実イベントが流れない。実プロファイルはユーザーのローカル Chrome での `chrome://inspect` 経由でしか取得できない。Claude 側からは「inspector が listen している」ところまでの動作確認に留める。

## 接続検証 (UI を使わず)

inspector が生きているかだけ確認したい時:

```bash
curl -s http://localhost:9229/json/version
# {"Protocol-Version":"1.3","Browser":"Bun","User-Agent":"Bun/...","WebKit-Version":"...","Bun-Version":"..."}
```

レスポンスが返れば inspector は健全。

## 取れるもの

- **CPU profile** (.cpuprofile): JS 関数名・ファイル・行番号付きで実行時間サンプリング。`buildSessionsList` の中のどの関数が遅い、までわかる
- **Heap snapshot**: メモリ使用量の object grouping。リーク調査
- **Sources**: 実行中の TS/JS にブレークポイントを置いて step 実行 (本番では基本やらない)

## 注意事項

- inspector mode への切替時にサーバを **systemctl restart** する。WebSocket クライアントは一旦切断 → 自動再接続するが、進行中のリクエストは落ちる。アクティブな操作中は避ける
- inspector port (9229) は `0.0.0.0` で listen する。tailnet 経由でしかアクセスできないなら良いが、もしポート公開設定があるなら enable 中は要注意
- `profile --seconds N` は Ctrl-C で中断すると drop-in が残る可能性がある。中断したら `cchub debug disable` を手動で実行
- 仕組み的には `~/.config/systemd/user/cchub.service.d/99-inspect.conf` の有無で切り替わる。直接編集も可能だが、CLI 経由が安全

## 参照

- 実装: `backend/src/commands/debug.ts`
- 追加バージョン: v0.1.127 (CHANGELOG 参照)
- Bun docs: https://bun.sh/docs/runtime/debugger
