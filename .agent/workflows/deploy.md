---
description: Cloud Run にデプロイする
---

# /deploy — Cloud Run へのデプロイ

## 手順

// turbo-all

1. 現在のプロジェクト設定を確認

```powershell
gcloud config get-value project
```

プロジェクトIDが `shaped-pride-486822-d5` でなければ設定：
```powershell
gcloud config set project shaped-pride-486822-d5
```

2. `.env` から GEMINI_API_KEY を取得

```powershell
(Get-Content .env | Select-String "GEMINI_API_KEY").Line.Split("=",2)[1]
```

3. Cloud Run にデプロイ

```powershell
gcloud run deploy moyamoya-catcher --source . --region asia-northeast1 --allow-unauthenticated --set-env-vars "GEMINI_API_KEY=<取得したキー>" --port 8080 --memory 512Mi
```

- Artifact Registry の確認が出たら `Y` を入力
- ビルド〜デプロイまで 2〜5分かかる

4. デプロイ後のURLを取得

```powershell
gcloud run services describe moyamoya-catcher --region asia-northeast1 --format "value(status.url)"
```

5. 結果をユーザーに報告（URLを含める）
