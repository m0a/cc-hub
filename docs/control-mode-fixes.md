# tmux Control Mode 修正履歴

## 修正一覧（時系列）

### 1. UTF-8 ハンドリング修正 (be77ee6, a77267b)
- **問題**: tmux control modeの`%output`のオクタルエスケープが正しくデコードされず、日本語が文字化け
- **修正**: オクタルデコーダーでマルチバイトシーケンスを正しく処理
- **影響ファイル**: `tmux-octal-decoder.ts`

### 2. マウスエスケープシーケンスフィルタ (b2a884b)
- **問題**: マウスイベントのエスケープシーケンスがtmuxに送信され、予期しない動作
- **修正**: マウス関連エスケープをフィルタリング
- **影響ファイル**: `tmux-control.ts`

### 3. initial-content をリサイズ後に遅延 (cb20179)
- **問題**: 接続直後にcapture-paneすると、ターミナルサイズが未確定で表示が崩れる
- **修正**: 最初のresizeメッセージを待ってからcapture-pane実行
- **影響ファイル**: `terminal.ts`

### 4. コンテナサイズからtmuxクライアントサイズを計算 (5a1f699)
- **問題**: 個別ペインサイズではなく、ウィンドウ全体サイズをtmuxに送る必要があった
- **修正**: `computeTotalSizeFromTree()` でツリー全体からサイズ合算
- **影響ファイル**: `DesktopLayout.tsx`

### 5. リサイズ無限ループ防止 (098c9ca)
- **問題**: resize → layout-change → resize のフィードバックループ
- **修正**: `lastSentSizeRef` で同一サイズの重複送信を抑制
- **影響ファイル**: `DesktopLayout.tsx`

### 6. proposeDimensions() に切り替え (3ad9c6b)
- **問題**: `FitAddon.fit()` がxterm.jsのサイズを勝手に変更し、tmuxのサイズ権限と衝突
- **修正**: `proposeDimensions()` でサイズ提案のみ取得し、実サイズはtmuxが決定
- **影響ファイル**: `Terminal.tsx`, `DesktopLayout.tsx`

### 7. PTYフォールバック削除 (08afb33, 5dedd12)
- **問題**: レガシーPTYモードとの切り替えロジックが複雑化
- **修正**: 制御モードを常時有効に、`useTerminal` hook削除
- **影響ファイル**: `Terminal.tsx`, `DesktopLayout.tsx`, hooks

### 8. capture-pane で初期コンテンツ取得 (現在のブランチ)
- **問題**: `send-keys C-l` は2回目以降の接続で `%output` を生成しない（同サイズだとSIGWINCHが発火しない）
- **修正**: `capture-pane -e -p -S -` で既存の画面内容+スクロールバックバッファを直接取得
- **影響ファイル**: `terminal.ts`, `tmux-control.ts`

### 9. ready シグナルでレースコンディション修正 (現在のブランチ)
- **問題**: WebSocket `open` ハンドラが非同期のため、`controlSession` がセットされる前にクライアントからresizeが到着し、ドロップされる
- **修正**: バックエンドが `{type: 'ready'}` を送信してからクライアントがresizeを送る
- **影響ファイル**: `terminal.ts`, `useControlTerminal.ts`, `shared/types.ts`

### 10. layoutPendingRef 安全タイムアウト (現在のブランチ)
- **問題**: `requestAnimationFrame` がバックグラウンドタブ等で実行されないと、layoutPendingがtrueのまま固まり、resizeが永遠にスキップされる
- **修正**: 500ms安全タイムアウトでフラグを強制クリア
- **影響ファイル**: `DesktopLayout.tsx`

### 11. onConnect で遅延resize再試行 (現在のブランチ)
- **問題**: セッション切り替え後、Terminalコンポーネントのrefが未登録の状態でsendControlResizeが呼ばれ、サイズ計算がnullになる
- **修正**: `onConnect` で100ms〜1000msの複数遅延で`sendControlResize()`を再試行
- **影響ファイル**: `DesktopLayout.tsx`

### 12. WebSocket close code 修正 (現在のブランチ)
- **問題**: `ws.close()` がデフォルトcode 1000で閉じるため、フロントエンドの自動再接続が働かない
- **修正**: エラー時は4004/4500を使い、1000以外で自動再接続
- **影響ファイル**: `terminal.ts`

## 既知の問題
- スクロール: capture-pane -S - でスクロールバック取得済み。xterm.jsで上スクロール可能か要確認
- リサイズ振動: サイドバー開閉時にサイズが変動するのは正常動作（ユーザー操作起因）
- デバッグログ: `[ws-debug]`, `[ws] msg` は開発用。リリース前に削除予定
