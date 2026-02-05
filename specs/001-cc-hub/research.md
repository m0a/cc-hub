# Research: CC Hub

**Date**: 2026-01-24
**Branch**: `main`

## 1. ターミナルUI: ghostty-web

### Decision
ghostty-webを採用

### Rationale
- xterm.jsとのAPI互換性があり、import文を変更するだけで移行可能
- GhosttyのVT100パーサーをWASM経由で利用し、複雑なエスケープシーケンスを正しく処理
- Coder社がメンテナンス

### 使用方法
```typescript
import { init, Terminal } from 'ghostty-web';

await init(); // WASM初期化必須
const term = new Terminal({ fontSize: 14 });
term.open(document.getElementById('terminal'));

// WebSocket連携
term.onData((data) => websocket.send(data));
websocket.onmessage = (e) => term.write(e.data);
```

### Alternatives Considered
| 選択肢 | 利点 | 欠点 |
|--------|------|------|
| xterm.js | 実績豊富 | 一部エスケープシーケンス未対応 |
| ghostty-web | 高精度パーサー | 比較的新しい (v0.4.0) |

---

## 2. API通信: Hono RPC

### Decision
Hono RPC + hcクライアントを採用

### Rationale
- 型安全なクライアント自動生成
- Zodバリデーターとの統合でリクエスト/レスポンス型推論
- Bunでネイティブ動作

### 使用方法
```typescript
// server.ts
const app = new Hono()
  .post('/sessions', zValidator('json', schema), handler)
  .get('/sessions/:id', handler);

export type AppType = typeof app;

// client.ts
import { hc } from 'hono/client';
import type { AppType } from './server';

const client = hc<AppType>('http://localhost:3000');
const res = await client.sessions.$post({ json: { name: 'my-session' } });
```

### WebSocket対応（Bun版）
```typescript
import { upgradeWebSocket, websocket } from 'hono/bun';

const app = new Hono().get('/ws/:sessionId', upgradeWebSocket((c) => ({
  onMessage(event, ws) { /* 処理 */ },
})));

export default { fetch: app.fetch, websocket };
```

### Alternatives Considered
| 選択肢 | 利点 | 欠点 |
|--------|------|------|
| Hono RPC | 軽量、型安全 | WebSocket RPCなし |
| tRPC | WebSocket対応 | セットアップ複雑 |

---

## 3. PTY管理: Bun組み込みPTY

### Decision
Bun.spawn({ terminal })を採用（Bun v1.3.5+）

### Rationale
- ネイティブPTYサポート、外部依存なし
- tmux/shell/vimなど対話型アプリを完全サポート
- WebSocketへの中継が容易

### 使用方法
```typescript
const proc = Bun.spawn(['tmux', 'attach', '-t', sessionName], {
  terminal: {
    cols: 80,
    rows: 24,
    data(terminal, data) {
      ws.send(data);
    },
  },
});

// 入力送信
proc.terminal.write('ls -la\n');

// リサイズ
proc.terminal.resize(120, 40);
```

### Alternatives Considered
| 選択肢 | 利点 | 欠点 |
|--------|------|------|
| Bun.spawn({ terminal }) | ネイティブ、依存なし | Linux/macOSのみ |
| @zenyr/bun-pty | クロスプラットフォーム | FFI依存 |
| node-pty | 実績豊富 | Node.jsネイティブ |

---

## 4. 状態検出: transcript.json (JSONL)

### Decision
~/.claude/projects/のJSONLファイルをfs.watchで監視

### ファイルの場所
```
~/.claude/projects/[エンコードされたパス]/[session-uuid].jsonl
```

### JSONL構造
```typescript
// ユーザーメッセージ
{ "type": "user", "message": { "role": "user", "content": "..." } }

// アシスタント応答
{ "type": "assistant", "message": { "stop_reason": null | "end_turn", ... } }

// ツール使用
{ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": "Read" }] } }
```

### 状態判定ロジック
| フィールド | 判定 |
|-----------|------|
| stop_reason === null | working（処理中） |
| stop_reason === "end_turn" | idle（完了） |
| content[].type === "tool_use" && name === "AskUserQuestion" | waiting_input |

### 監視実装
```typescript
import { watch } from 'fs';

watch(`${process.env.HOME}/.claude/projects/-home-m0a-multicc/`, (eventType, filename) => {
  if (filename?.endsWith('.jsonl')) {
    // 差分読み取り
  }
});
```

### Alternatives Considered
| 選択肢 | 利点 | 欠点 |
|--------|------|------|
| fs.watch | 標準API | OS間の挙動差異 |
| chokidar | 安定 | 依存追加 |
| ポーリング | シンプル | CPU負荷 |

---

## 5. 通知: Web Push (VAPID)

### Decision
web-push-browserを採用

### Rationale
- ゼロ依存でBun/Deno/Workers対応
- 標準web-push(Node.js)はBun互換性に問題あり

### 使用方法
```typescript
import { generateVAPIDKeys, sendNotification } from 'web-push-browser';

const { publicKey, privateKey } = await generateVAPIDKeys();

await sendNotification(subscription, JSON.stringify({
  title: 'タスク完了',
  body: 'Claude Codeの処理が完了しました'
}), {
  vapidDetails: { subject: 'mailto:your@email.com', publicKey, privateKey }
});
```

### Service Worker
```typescript
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body })
  );
});
```

### Alternatives Considered
| 選択肢 | 利点 | 欠点 |
|--------|------|------|
| web-push-browser | ゼロ依存、Bun対応 | 新しい |
| web-push (Node) | 実績豊富 | Bun互換性問題 |

---

## Summary

| 技術領域 | 選択 | 理由 |
|---------|------|------|
| ターミナルUI | ghostty-web | xterm.js互換、高精度 |
| API層 | Hono RPC + hc | 型安全、Bun最適化 |
| PTY | Bun.spawn({ terminal }) | ネイティブ、依存なし |
| 状態監視 | fs.watch + JSONL | 標準API |
| Push通知 | web-push-browser | Bun対応 |
