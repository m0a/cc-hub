# release

バイナリをビルドして ~/bin にデプロイします。

## Trigger
- 'release', 'リリース', 'deploy', 'デプロイ', 'build binary', 'バイナリ作成'

## Instructions

1. バイナリをビルド
```bash
bun run build:binary
```

2. ~/bin にコピー
```bash
cp ./dist/cchub ~/bin/cchub
```

3. 確認
```bash
ls -la ~/bin/cchub
```

ビルドとデプロイが完了したら、ファイルサイズと更新日時を報告してください。
