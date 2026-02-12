---
description: GitHubにコミット＆プッシュする
---

# /push — GitHub へのプッシュ

## 手順

// turbo-all

1. 変更内容を確認する

```powershell
git status
```

2. 全ファイルをステージング

```powershell
git add -A
```

3. テストが存在する場合は実行して PASS を確認

```powershell
npm test
```

4. コミットメッセージを生成してコミット（**`/commit` ルールに従う**）
   - `git diff --cached --stat` で変更ファイルを確認
   - 変更内容に基づいて適切なコミットメッセージを自動生成
   - prefix は `feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:` から選択
   - 詳細は `/commit` ワークフローを参照

```powershell
git commit -m "<prefix>: <件名>" -m "<本文（任意）>"
```

5. main ブランチにプッシュ

```powershell
git push origin main
```

6. 結果をユーザーに報告

