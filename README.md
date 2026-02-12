# Moyamoya Catcher (+Deliver)

地域で活動する人の「お金・人の不安」を、
**90日計画 + 資金計画 + 送れる文章**に変換するアプリです。

## Live Demo

https://moyamoya-catcher-7zasxlal4q-an.a.run.app/

## Quick Start

Requirements:
- Node.js 18+
- Gemini API key (optional)

```bash
npm install
npm run dev
# -> http://localhost:3000
```

PowerShell example:

```powershell
$env:GEMINI_API_KEY="your_api_key"
```

`.env` example:

```env
GEMINI_API_KEY=your_api_key
ALLOWED_ORIGINS=http://localhost:3000
```

## Tech Stack

- Frontend: Vanilla JS (`public/`)
- Backend: Node.js + Express (`server.js`)
- Runtime: Google Cloud Run
- AI: Gemini API
- Data: Firestore (KPI events only)

## Security / Privacy

- Do not input personal information (name/address/contact details)
- Free-text input is not stored as analytics events
- Output is a draft; final judgment is by the user

## Zenn

- 詳細設計・背景は Zenn 記事で公開予定

## License

MIT
