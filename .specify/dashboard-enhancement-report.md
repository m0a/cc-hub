# CC Hub ダッシュボード機能強化レポート

## 調査概要

Claude Code から取得可能な情報を調査し、ダッシュボード/セッション一覧の機能強化案をまとめました。

---

## 1. データソース一覧

### 1.1 ローカルファイル（即座に利用可能）

| ソース | パス | 主な情報 |
|--------|------|----------|
| セッションログ | `~/.claude/projects/<project>/<session>.jsonl` | 全会話履歴、ツール使用、タイムスタンプ |
| 統計キャッシュ | `~/.claude/stats-cache.json` | 日別統計、モデル使用量、時間帯分布 |
| プロンプト履歴 | `~/.claude/history.jsonl` | 全プロンプト、プロジェクト、時刻 |
| ファイル変更履歴 | `~/.claude/file-history/` | セッションごとの変更ファイル |
| セッションインデックス | `sessions-index.json`（プロジェクト内） | Gitブランチ、プロジェクトパス、サマリー |

### 1.2 OpenTelemetry（設定で有効化）

| データ種別 | 情報 |
|-----------|------|
| メトリクス | セッション数、コード行数、コミット/PR数、トークン使用量、コスト |
| イベント | ツール実行結果、API呼び出し、ツール許可/拒否 |

### 1.3 Analytics API（Admin権限必要・組織向け）

個人利用では使用不可。組織向けの高度な分析用。

---

## 2. 機能追加候補

### カテゴリA: 統計・分析ダッシュボード

| ID | 機能 | 説明 | データソース |
|----|------|------|-------------|
| A1 | 日別使用統計グラフ | メッセージ数・セッション数・ツールコール数の推移 | stats-cache.json |
| A2 | 時間帯ヒートマップ | 何時に作業しているかの可視化 | stats-cache.json (hourCounts) |
| A3 | モデル別トークン使用量 | Opus vs Sonnet の使用比較 | stats-cache.json (modelUsage) |
| A4 | 推定コスト表示 | トークン使用量からの概算コスト | stats-cache.json + 料金計算 |
| A5 | ツール使用統計 | Read/Edit/Bash等の使用頻度ランキング | .jsonl パース |
| A6 | プロジェクト別統計 | プロジェクトごとのセッション数・時間 | projects/ ディレクトリ |

### カテゴリB: セッション一覧の強化

| ID | 機能 | 説明 | データソース |
|----|------|------|-------------|
| B1 | セッション継続時間表示 | 開始から終了までの時間 | .jsonl タイムスタンプ |
| B2 | メッセージ数表示 | 会話の長さを把握 | .jsonl行数 / index |
| B3 | Gitブランチ表示 | 作業中のブランチ名 | .jsonl (gitBranch) |
| B4 | CCバージョン表示 | 使用されたClaude Codeバージョン | .jsonl (version) |
| B5 | 最終ツール表示 | 最後に使用されたツール名 | .jsonl パース |
| B6 | セッションタグ/ラベル | ユーザーによる分類 | 新規実装（メタデータ） |

### カテゴリC: 検索・フィルタリング

| ID | 機能 | 説明 | データソース |
|----|------|------|-------------|
| C1 | プロンプト検索 | 過去の質問/指示を検索 | history.jsonl |
| C2 | プロジェクト別フィルタ | 特定プロジェクトのセッションのみ表示 | projects/ ディレクトリ |
| C3 | 日付範囲フィルタ | 期間指定でセッション絞り込み | .jsonl タイムスタンプ |
| C4 | ブランチ別フィルタ | 特定ブランチの作業履歴 | .jsonl (gitBranch) |
| C5 | ツール使用フィルタ | 「Write使用」などで絞り込み | .jsonl パース |

### カテゴリD: セッション詳細・履歴

| ID | 機能 | 説明 | データソース |
|----|------|------|-------------|
| D1 | 会話履歴ビューワー | セッションの全会話を閲覧 | .jsonl 全体 |
| D2 | ファイル変更タイムライン | いつどのファイルを変更したか | file-history/ + .jsonl |
| D3 | ツール使用タイムライン | ツール実行履歴の可視化 | .jsonl (tool_use) |
| D4 | セッション再開ボタン | `claude -r <session>` を実行 | tmux連携 |
| D5 | セッションエクスポート | 会話をMarkdown/JSONで出力 | .jsonl 変換 |

### カテゴリE: リアルタイム監視

| ID | 機能 | 説明 | データソース |
|----|------|------|-------------|
| E1 | アクティブセッションハイライト | 現在進行中のセッションを強調 | tmux + .jsonl監視 |
| E2 | 進行状況インジケーター | 処理中/待機中/完了の表示 | .jsonl最終行 |
| E3 | リアルタイムトークン消費 | 現在セッションのトークン使用量 | OpenTelemetry or API |
| E4 | 通知システム | 待機状態になったら通知 | WebSocket + .jsonl監視 |

---

## 3. 実装難易度

| 難易度 | 説明 | 該当機能 |
|--------|------|----------|
| 🟢 低 | 既存データ読み込みのみ | A1, A2, A3, B1, B2, B3, B4, C2, C3 |
| 🟡 中 | パース処理が必要 | A5, A6, B5, C1, C4, C5, D1, D2, D3, D5 |
| 🔴 高 | 新規機能/複雑なUI | A4, B6, D4, E1, E2, E3, E4 |

---

## 4. 優先度検討のための質問

以下を考慮して優先度を決めましょう：

1. **最も使用頻度が高い操作は？**
   - セッション一覧を見る
   - 過去のプロンプトを探す
   - 統計を確認する

2. **現在の不満点は？**
   - セッションの区別がつきにくい
   - 何を作業したか思い出せない
   - コスト把握ができない

3. **モバイル/タブレットでの優先機能は？**
   - タップしやすいUI
   - シンプルな一覧表示
   - 詳細は別画面

---

## 5. 確定優先度（ユーザー回答に基づく）

### ユーザーの課題・要望

| 項目 | 回答 |
|------|------|
| 主な課題 | リアルタイム状態が不明、統計/コストが見えない、過去セッション再開 |
| 主要デバイス | タブレット/モバイル優先 |
| 最優先機能 | 使用統計グラフ |

---

### Phase 1: 最優先（即実装）

| ID | 機能 | 理由 |
|----|------|------|
| **L1** | リミット警告・予測表示 | **最重要** - 使用制限回避のため |
| **A1** | 日別使用統計グラフ | ユーザー最優先要望 |
| **A3** | モデル別トークン使用量 | コスト把握の基盤 |
| **A4** | 推定コスト表示 | 統計/コストが見えない課題を解決 |
| **E1** | アクティブセッションハイライト | リアルタイム状態の視認性 |
| **E2** | 進行状況インジケーター | 質問待ち等の状態把握 |
| **D4** | セッション再開ボタン | 過去セッション再開の要望 |

### L1: リミット警告・予測表示（新規追加）

**データソース**: `~/.claude/limit-tracker/data/usage_data.json` + `config/`

**表示内容**:
- 5時間サイクル: 使用プロンプト数 / 上限、リセットまでの時間
- 週間リミット: Opus/Sonnet 別の使用時間 / 上限
- 予測: 現在のペースでいつリミットに到達するか
- 警告: リミット到達後の使用不可期間

**警告レベル**:
| レベル | 条件 | 表示 |
|--------|------|------|
| 🟢 正常 | 使用率 < 50% | コンパクト表示 |
| 🟡 注意 | 使用率 50-80% | 詳細表示 |
| 🔴 警告 | 使用率 > 80% | バナー警告 |
| 🚨 危険 | 24時間以内に到達予測 | 全画面警告 |

**プラン自動取得**:
- `~/.claude/.credentials.json` から自動取得（推奨）
  - `subscriptionType`: "max" / "pro" / "free"
  - `rateLimitTier`: "default_claude_max_20x" / "default_claude_max_5x" / "pro" 等
- フォールバック: 手動設定（設定画面から変更可能）

| プラン | 5hサイクル | 週間Sonnet | 週間Opus |
|--------|-----------|-----------|----------|
| Free/Pro | 10-40 | 40-80h | - |
| Max 5x | 50-200 | 140-280h | 15-35h |
| Max 20x | 200-800 | 240-480h | 24-40h |

### Phase 2: 重要機能

| ID | 機能 | 理由 |
|----|------|------|
| **B1** | セッション継続時間表示 | セッション識別の補助 |
| **B2** | メッセージ数表示 | 会話量の把握 |
| **B3** | Gitブランチ表示 | 作業内容の識別 |
| **C2** | プロジェクト別フィルタ | セッション整理 |

### Phase 3: 付加価値

| ID | 機能 | 理由 |
|----|------|------|
| **A2** | 時間帯ヒートマップ | 作業パターン可視化 |
| **C1** | プロンプト検索 | 過去作業の発見 |
| **D1** | 会話履歴ビューワー | 詳細確認 |
| **A5** | ツール使用統計 | 高度な分析 |

---

## 6. Phase 1 詳細設計

### 6.1 日別使用統計グラフ (A1)

**データソース**: `~/.claude/stats-cache.json`

```typescript
interface DailyActivity {
  date: string;        // "2026-01-29"
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}
```

**UI要件（モバイル優先）**:
- 横スクロール可能な棒グラフ
- タップで日付詳細表示
- 期間切り替え（7日/30日/全期間）

### 6.2 モデル別トークン使用量 (A3)

**データソース**: `stats-cache.json.modelUsage`

```typescript
interface ModelUsage {
  [model: string]: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  }
}
```

**UI要件**:
- ドーナツチャート（Opus vs Sonnet比率）
- モデル別詳細ビュー

### 6.3 推定コスト表示 (A4)

**計算式（2026年1月現在）**:
```typescript
// Claude Sonnet 4.5
const sonnetCost = {
  input: 3.00 / 1_000_000,      // $3/MTok
  output: 15.00 / 1_000_000,    // $15/MTok
  cacheRead: 0.30 / 1_000_000,  // $0.30/MTok
  cacheWrite: 3.75 / 1_000_000  // $3.75/MTok
};

// Claude Opus 4.5
const opusCost = {
  input: 15.00 / 1_000_000,     // $15/MTok
  output: 75.00 / 1_000_000,    // $75/MTok
  cacheRead: 1.50 / 1_000_000,  // $1.50/MTok
  cacheWrite: 18.75 / 1_000_000 // $18.75/MTok
};
```

**UI要件**:
- 日別コスト推移グラフ
- 累計コスト表示
- モデル別内訳

### 6.4 進行状況インジケーター (E2)

**状態判定（既存実装の拡張）**:
```typescript
type SessionState =
  | 'processing'     // assistant応答生成中
  | 'waiting_user'   // AskUserQuestion待ち
  | 'waiting_plan'   // EnterPlanMode/ExitPlanMode待ち
  | 'idle'           // 入力待ち
  | 'completed';     // セッション終了
```

**UI要件**:
- カラーインジケーター（緑=処理中、黄=待機、灰=終了）
- パルスアニメーション
- 待機ツール名表示

### 6.5 セッション再開ボタン (D4)

**実装方法**:
```bash
# 新規tmuxセッション作成 + claude -r 実行
tmux new-session -d -s "cc-resumed-{timestamp}" \
  "cd {workingDir} && claude -r {sessionId}"
```

**UI要件**:
- セッション行に再開ボタン
- 確認ダイアログ
- 新規ターミナルタブで開く

---

## 7. API エンドポイント設計

### 新規エンドポイント

```typescript
// 統計データ取得
GET /api/stats
Response: {
  dailyActivity: DailyActivity[];
  modelUsage: ModelUsage;
  estimatedCost: { total: number; byModel: Record<string, number> };
  hourCounts: Record<number, number>;
}

// セッション再開
POST /api/sessions/:id/resume
Request: { workingDir: string }
Response: { newSessionId: string; tmuxSession: string }

// 過去セッション一覧（終了済み含む）
GET /api/sessions/history
Query: { project?: string; limit?: number; offset?: number }
Response: { sessions: HistoricalSession[]; total: number }
```

---

## 8. 次のステップ

1. [x] 優先度確定
2. [ ] Phase 1 の API 実装
3. [ ] フロントエンド UI 実装
4. [ ] モバイル最適化テスト
