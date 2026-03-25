# ♟ Chess Education

Stockfish 18 WASM 기반 체스 분석 웹앱. Firebase 인증 + Groq AI 코치 기능을 포함합니다.

---

## 기술 스택

- **프론트엔드** — 순수 HTML/CSS/JS (빌드 도구 없음)
- **체스 엔진** — Stockfish 18 WASM (브라우저에서 직접 실행, 서버 불필요)
- **인증 / DB** — Firebase Authentication + Firestore
- **AI 코치** — Groq API (Llama-3.3-70b) / Vercel Serverless Function 프록시
- **호스팅** — Vercel

---

## 프로젝트 구조

```
CHESS/
├── chess-wasm-fixed.html   # 메인 체스 분석 보드
├── auth.html               # 로그인 / 회원가입
├── play.html               # 온라인 대국 로비
├── records.html            # 기보 기록
│
├── chess-wasm-fixed/       # 분석 보드 JS 모듈
│   ├── chess.js            # 체스 룰 · 기물 상수 · 수 분류
│   ├── engine.js           # Stockfish 워커 · 분석 로직
│   ├── game.js             # ChessGame 클래스 · 평가 바
│   ├── ui.js               # UI 초기화 · 테마 · 사운드 · 키보드
│   └── coach.js            # AI 코치 · 위협 분석 · 최선수 설명
│
├── api/
│   └── groq.js             # Vercel Serverless Function (Groq 프록시)
│
├── sound/                  # 착수 효과음 mp3
├── stockfish/              # Stockfish WASM 바이너리
└── vercel.json             # Vercel 라우팅 설정
```

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 체스 분석 보드 | Stockfish 18 WASM으로 브라우저에서 실시간 분석 |
| 수 분류 | Brilliant / Great / Best / Excellent / Good / Inaccuracy / Mistake / Blunder |
| PGN 불러오기 / 저장 | PGN 파싱 · Firestore에 게임 저장 |
| AI 코치 | Groq Llama-3.3-70b — 전략 / 계획 / 목표 구조로 한국어 설명 |
| 위협 분석 | 현재 포지션의 위협과 대응 방안 자동 분석 |
| 최선수 설명 | 엔진 추천 수순 각각에 대한 이유 설명 |
| 테마 / 기물 스타일 | 5가지 보드 테마 · 5가지 기물 스타일 |
| 변화수 탐색 | 엔진 라인 클릭으로 수순 탐색 · 키보드 방향키 지원 |

---

## 시작하기

### 1. 저장소 클론

```bash
git clone https://github.com/kpinkss0204/chess_education.git
cd chess
```

### 2. Firebase 설정

[Firebase Console](https://console.firebase.google.com)에서 프로젝트를 생성하고 `auth.html`, `chess-wasm-fixed.html`의 `firebaseConfig`를 교체하세요.

Firebase Console → Authentication → **Settings → Authorized domains**에 배포 도메인을 추가해야 합니다.

### 3. Vercel 배포

```bash
# Vercel CLI 설치
npm i -g vercel

# 배포
vercel
```

Vercel 대시보드 → Settings → **Environment Variables**에 아래 값을 추가하세요:

| 키 | 값 |
|----|-----|
| `GROQ_API_KEY` | Groq Console에서 발급한 API 키 |

### 4. 로컬 개발 (선택)

별도 빌드 과정 없이 정적 파일 서버로 바로 실행 가능합니다.

```bash
# Python
python -m http.server 8080

# 또는 Node
npx serve .
```

> WASM은 `file://` 프로토콜에서 동작하지 않으므로 반드시 로컬 서버를 사용하세요.

---

## 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `GROQ_API_KEY` | ✅ | Groq API 키. `api/groq.js`에서 사용 |

---
