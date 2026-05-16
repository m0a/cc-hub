---
name: release
description: CC Hub のリリース手順を実行する。バージョンバンプ、mainへのpush、GitHub Release作成、CI完了待ち、cchub update を自動化する。「/release」「リリースして」「リリース」「バージョンアップ」「release」などのコマンドで起動する。
---

# CC Hub Release

## Release Workflow

1. **最新化確認**: `git fetch origin` で最新を取得し、現在のブランチが origin/main の真上にあることを確認
2. **リリースブランチ作成**: `git checkout -b release/vX.X.X` で専用ブランチを切る（work-1 などの作業ブランチを直接 push しない）
3. **CHANGELOG.md 更新**: 新バージョンのエントリを先頭に追加（Added/Fixed/Changed セクション）
4. **バージョンバンプ**: ルートの `package.json` の `version` フィールドをインクリメント（patch）
5. **アーキテクチャドキュメント更新**: `python3 scripts/build-architecture-html.py` を実行
   - `architecture.json` の `version` / `generated` を `package.json` と同期
   - `architecture.html` に JSON を再埋め込み
   - 出力を `architecture.json architecture.html` として一緒にステージングする
6. **コミット & Push**:
   ```bash
   git add package.json CHANGELOG.md architecture.json architecture.html
   git commit -m "chore: bump version to X.X.X"
   git push -u origin release/vX.X.X
   ```
7. **PR 作成 & マージ**:
   ```bash
   gh pr create --base main --title "Release vX.X.X" --body "..."
   gh pr merge --merge  # 履歴を保ったままマージ（必要なら --squash）
   ```
   マージ完了を確認してから次へ進む（`gh pr view --json state`）
8. **GitHub Release 作成**:
   ```bash
   gh release create vX.X.X --title "vX.X.X" --notes "リリースノート"
   ```
9. **CI 完了待ち**: `gh run list --limit 3` でワークフロー状況を確認。バイナリビルドは CI が自動で行うため、ローカルでの `bun run build:binary` は **絶対に不要**
10. **本番更新**: `cchub update` を実行
11. **ブランチクリーンアップ**: `git fetch origin && git checkout -B work-1 origin/main && git branch -D release/vX.X.X` で作業ブランチを最新の main にリセットし、リリースブランチを削除

## Important Rules

- **ローカルでバイナリビルドしない** — CI が自動でビルドしてリリースにアタッチする
- バージョンは semver patch を基本とする（例: 0.0.41 → 0.0.42）
- major/minor バンプはユーザーに確認してから行う
- リリースノートは変更内容を簡潔に記載する

## Release Notes Format

```
## Changes
- feat: 新機能の説明
- fix: バグ修正の説明
- chore: その他の変更

## Notes
特記事項があれば記載
```

最近のコミットログ (`git log --oneline origin/main~10..origin/main`) を参照してリリースノートを作成する。
