---
name: glasses-upload
description: G2グラスアプリをビルドしてEVEN Hubにアップロードする。「/glasses-upload」「グラスアップロード」「ehpkアップロード」「グラスデプロイ」などで起動する。
---

# G2 Glasses EVEN Hub Upload

## Workflow

1. **ビルド**:
   ```bash
   cd /home/m0a/cchub-work-1/glasses
   npm run build
   ```

2. **バージョンバンプ**: `glasses/app.json` の `version` をpatchインクリメント

3. **ehpkパック**:
   ```bash
   npx @evenrealities/evenhub-cli pack app.json dist
   ```
   → `out.ehpk` が生成される

4. **コミット**（ユーザーが求めた場合）:
   ```bash
   git add glasses/app.json glasses/out.ehpk glasses/src/
   git commit -m "feat(glasses): 変更内容の説明"
   ```

5. **EVEN Hubにログイン**（agent-browser使用）:
   ```bash
   agent-browser --session-name evenhub open https://hub.evenrealities.com/hub
   agent-browser wait --load networkidle
   agent-browser snapshot -i
   ```
   - ログイン済みセッションがあればスキップ
   - 未ログインの場合: Sign in → Email: `$EVENHUB_EMAIL` → Password: `$EVENHUB_PASSWORD`
   - クレデンシャルは環境変数から読み取る

6. **アプリ詳細ページに移動**:
   ```bash
   # "CC Hub Glasses" をクリック
   agent-browser click @eXX  # snapshot結果のCC Hub Glassesのref
   agent-browser wait --load networkidle
   ```

7. **ビルドアップロード**:
   ```bash
   # "Upload a build" ボタンをクリック
   agent-browser click @eXX  # Upload a buildのref
   agent-browser wait 3000
   ```
   
   ファイル入力はCDP経由で設定する（通常のclick --uploadでは動作しない）:
   ```python
   python3 -c "
   import json, asyncio, websockets
   
   async def main():
       # agent-browserのCDP URLからページWSを取得
       # curl -s http://127.0.0.1:PORT/json でページターゲットを取得
       async with websockets.connect(PAGE_WS_URL) as ws:
           msg_id = 0
           async def send_cmd(method, params={}):
               nonlocal msg_id
               msg_id += 1
               await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params}))
               while True:
                   resp = json.loads(await ws.recv())
                   if resp.get('id') == msg_id:
                       return resp
           
           await send_cmd('DOM.enable')
           doc = await send_cmd('DOM.getDocument')
           root = doc['result']['root']['nodeId']
           found = await send_cmd('DOM.querySelector', {'nodeId': root, 'selector': 'input[type=file]'})
           node_id = found['result']['nodeId']
           result = await send_cmd('DOM.setFileInputFiles', {'nodeId': node_id, 'files': ['/home/m0a/cchub-work-1/glasses/out.ehpk']})
           print(f'Result: {json.dumps(result)}')
   
   asyncio.run(main())
   "
   ```

8. **チェンジログ入力 & 送信**:
   ```bash
   agent-browser snapshot -i
   agent-browser fill @eXX "変更内容"  # Change logテキストボックスのref
   agent-browser click @eXX  # Add buildボタンのref
   agent-browser wait --load networkidle
   ```

9. **確認**: snapshotで新しいバージョンがリストに表示されることを確認

10. **Beta切り替え**（3ステップ）:

    **Step A: 既存Betaビルドを開いてPrivateに戻す**
    - ビルドリストでBetaマークのあるビルドをクリックして展開
    - 展開パネル内のBetaバッジをevalでクリック（座標はx:800付近、y:189付近）:
      ```bash
      agent-browser eval 'document.elementFromPoint(800, 189)?.click()'
      ```
    - ドロップダウンから「Private」を選択 → 「Confirm」

    **Step B: ページリロード**
    - `agent-browser open "https://hub.evenrealities.com/hub"` で再読み込み
    - CC Hub Glassesアプリに再度移動

    **Step C: 新ビルドをBetaに昇格**
    - 新ビルドをクリックして展開
    - 展開パネル内のPrivateバッジをevalでクリック（同様の座標方法）
    - ドロップダウンから「Beta」→「Promote to Beta」

    ※ snapshotのrefではバッジクリックが効かないため、`document.elementFromPoint()` で直接クリックする必要がある

11. **ブラウザ終了**:
    ```bash
    agent-browser close
    ```

## CDP経由ファイルアップロードの手順

EVEN HubのファイルアップロードダイアログはDrag & Dropベースで、通常のfile input操作では動作しない。以下の手順でCDP APIを直接使う:

1. `agent-browser get cdp-url` でWebSocket URLを取得
2. URLからホスト:ポートを抽出し `curl -s http://HOST:PORT/json` でページターゲットのwebSocketDebuggerUrlを取得
3. python3 + websocketsでDOM.setFileInputFilesを呼び出す

## Important Notes

- `npx evenhub pack` ではなく `npx @evenrealities/evenhub-cli pack` を使う
- EVEN Hub CLIにはアップロードコマンドがないためブラウザ自動化が必要
- agent-browserの `--session-name evenhub` でセッションを永続化するとログイン不要になる
- Betaバッジはsnapshotのrefでは操作不可、`document.elementFromPoint()`で座標クリックが必要
- アクセスは常にTailscale IP（100.91.210.90）を使用
