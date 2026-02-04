# Changelog

All notable changes to this project will be documented in this file.

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
