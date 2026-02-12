# Moyamoya Catcher (+Deliver)

地域に根差して活動する人の「漠然としたお金・人の不安」を、**90日計画・資金計画・関係者宛ての文章パック**に変換して、地域活動の次の一手を作るエージェントです。

## 何を解決するか

- 対象: 地域で活動する小規模な個人・チーム（任意団体/小さな事業/個人事業主）
- 課題: お金・人手の不安が言語化できず、行動が止まる
- 解決: チップで不足情報を回収し、実行可能な成果物に変換
- 価値: 約3分で「不安」から「送れる文章」へ

## 主な機能

- チャット + 選択チップでヒアリング（URL入力は任意）
- 4系統の出力を生成
  - 活動紹介
  - 90日アクションプラン
  - 資金複線化プラン
  - 自治体/企業/地域向け文章パック
- 品質保証ループ
  - `generate -> audit -> expert-review -> improve`
- PDFエクスポート

## システム構成（要約）

- Frontend: Vanilla JS SPA (`public/`)
- Backend: Node.js + Express (`server.js`)
- Runtime: Google Cloud Run
- AI: Gemini API
- Data: Firestore（KPIイベントのみ。自由テキストは保存しない）

## セキュリティとデータ方針

- 個人情報（氏名/住所/連絡先/子どもが特定される情報）は入力禁止
- KPIイベントはホワイトリスト方式（enum値中心）
- 自由テキストは保存しない方針
- 出力は提案のたたき台。最終判断は利用者

詳細は `docs/運用設計_v1.md` を参照してください。

## 実証状況（2026-02-11時点）

- ユーザーテスト: 2件
- 数値評価回収: 1件
- 回収分平均満足度: `4.0 / 5.0`
- 文言改善フィードバックは即日反映済み

詳細は `docs/2026-02-11_実証ログ_ユーザーテスト.md` を参照してください。

## クイックスタート

前提:
- Node.js 18+
- Gemini APIキー（任意。未設定時は一部モック動作）

```bash
# 依存インストール
npm install

# 環境変数を設定（例）
# PowerShell:
$env:GEMINI_API_KEY="your_api_key"

# 起動
npm run dev
# -> http://localhost:3000
```

`.env` ファイルを使う場合は、プロジェクト直下に手動作成してください。

例:
```env
GEMINI_API_KEY=your_api_key
ALLOWED_ORIGINS=http://localhost:3000
```

## テスト

```bash
npm test
```

## Live Demo

https://moyamoya-catcher-7zasxlal4q-an.a.run.app/

## 詳細記事（Zenn）

- 公開記事: <!-- TODO: Zenn公開URLを記載 -->
- 下書き: `docs/2026-02-11_Zenn記事_モヤモヤキャッチャー開発記.md`

## License

MIT
