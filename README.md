# Chess Edu - 통합 체스 교육 및 대국 플랫폼

**Chess Edu**는 체스 입문자부터 숙련자까지 모두를 위한 웹 기반 통합 교육 플랫폼입니다. 단순한 대국을 넘어, 사용자의 실제 대국 기보를 정밀 분석하고 개인화된 훈련 환경을 제공하는 것을 목표로 합니다.

---

## ✨ 핵심 기능

### 1. 지능형 기보 분석 및 통계 (`records.html`)
- **Stockfish WASM 통합**: 브라우저에서 서버 없이도 강력한 엔진 분석을 수행합니다.
- **전술 감지 시스템**: `chess-tactics.js`를 통해 대국 중 발생한 포크(Fork), 핀(Pin), 스큐어(Skewer), 체크메이트 기회 등을 자동으로 식별합니다.
- **개인화 통계**: 정확도(Accuracy), ACPL(Average Centipawn Loss), 기물별 활용도 등을 시각화하여 제공합니다.

### 2. 개인화된 퍼즐 훈련 (`puzzle.html`)
- **기보 기반 퍼즐 생성**: 사용자가 실제 대국에서 놓쳤던 결정적인 수나 성공했던 전술 장면을 자동으로 추출하여 맞춤형 퍼즐로 변환합니다.
- **Lichess API 연동**: 수만 개의 고품질 퍼즐 데이터를 난이도 및 테마별로 제공합니다.
- **실시간 피드백**: 퍼즐 풀이 중 즉각적인 정오답 판정 및 힌트 기능을 지원합니다.

### 3. 온라인 실시간 대국 (`play.html`)
- **Firebase 기반 매칭**: 실시간 데이터베이스를 활용한 빠른 대국 매칭 및 동기화.
- **대국 중 분석**: 대국 종료 후 즉시 분석 보드로 이동하여 복기가 가능합니다.

### 4. 체계적인 학습 모드 (`study.html`)
- **오프닝 탐색기**: 수백만 개의 마스터 대국 데이터를 기반으로 한 오프닝 이론 학습.
- **엔드게임/오프닝 훈련**: 특정 국면(Endgame, Opening)을 설정하고 엔진과 대국하며 실전 감각을 익힙니다.

### 5. AI 코칭 및 분석 도구
- **멀티 모델 AI 지원**: Google Gemini 및 Groq API를 연동하여 전술적 조언과 국면 설명을 제공합니다.
- **분석 전용 보드 (`chess-wasm-fixed.html`)**: 변화수 탐색, 엔진 라인 시각화, PGN/FEN 불러오기 및 저장 기능을 포함한 전문 분석 툴입니다.

---

## 🛠 기술 스택

- **Frontend**: HTML5, Vanilla CSS, Modern JavaScript (ES6+)
- **Backend/Infrastructure**: 
  - **Firebase**: Authentication (사용자 인증), Firestore (기보/전술 데이터), Realtime Database (실시간 대국)
  - **Vercel**: 서버리스 API 함수 (API 프록시 관리)
- **Engine**: Stockfish 18 (WebAssembly 포팅 버전)
- **APIs**: Lichess API (퍼즐/오프닝), Google Gemini API, Groq API

---

## 📂 파일 및 디렉토리 상세 맵

### 🌐 메인 페이지 (Root)
- `chess-wasm-fixed.html`: 프로젝트 진입점 (홈 화면).
- `play.html`: **온라인 실시간 대국** 페이지. Firebase Realtime DB를 통한 대국 매칭 및 플레이.
- `puzzle.html`: **체스 퍼즐** 페이지. Lichess 퍼즐 및 내 기보 기반 퍼즐 제공.
- `records.html`: **기보 기록 및 통계** 페이지. 저장된 게임 목록 확인 및 Stockfish 심층 분석.
- `opening-explorer.html`: **오프닝 탐색기**. 수백만 대국 데이터를 통한 오프닝 경로 학습.
- `study.html`: **학습 메인**. 오프닝/엔드게임 학습 선택 화면.
- `study-opening.html` / `study-endgame.html`: 특정 오프닝 및 엔드게임 시나리오 집중 학습.
- `practice.html`: **엔진 연습**. 특정 포지션에서 Stockfish와 대국 연습.
- `chess-wasm-fixed.html`: **전문가용 분석 보드**. FEN/PGN 로드 및 정밀 엔진 분석 도구.
- `auth.html`: **사용자 인증**. 로그인, 회원가입 및 소셜 로그인 관리.

### ⚙️ 시스템 및 설정 (Root JS/CSS)
- `auth-check.js`: **전역 인증 관리**. Firebase 초기화 및 페이지 접근 권한 제어.
- `sidebar-component.js`: 모든 페이지에 공통으로 적용되는 **내비게이션 사이드바** UI 로직.
- `theme-global.js`: 다크모드/라이트모드 전환 및 상태 유지 로직.
- `theme-ui.css`: 프로젝트 전반의 핵심 UI 스타일 및 테마 변수 정의.
- `stockfish-shared-worker.js`: Stockfish 엔진을 효율적으로 구동하기 위한 **Shared Worker** 관리.

### 🧠 핵심 로직 모듈 (`chess-wasm-fixed/`)
- `game.js`: **체스 보드 코어**. 기물 이동, 렌더링, 게임 상태(FEN/PGN) 관리 클래스.
- `engine.js`: **Stockfish 통신 레이어**. 엔진 명령 전송 및 분석 결과 수신 처리.
- `chess-tactics.js`: **전술 탐지 엔진**. 포크, 핀, 스큐어 등 10여 가지 전술 패턴 식별.
- `lichess-judgment.js`: **수 판정 로직**. Centipawn 손실에 따른 Blunder, Mistake 등 등급 분류.
- `parse-pgn-states.js`: PGN 데이터를 분석하여 각 수의 상태와 국면 정보를 객체화.
- `coach.js`: **AI 코칭 시스템**. 현재 국면의 전략적 조언 및 설명 생성.
- `ui.js`: 보드 하이라이트, 화살표 그리기, 사운드 등 **보드 인터랙션** 관리.
- `hints.js`: 다음 수 추천 및 전략적 힌트 시각화.
- `position-brief.js`: 현재 포지션에 대한 간략한 요약 및 평가 정보 생성.
- `endgame-practice.js`: 엔드게임 시나리오(K+Q vs K 등) 자동 설정 로직.
- `practice-page.js`: 연습 모드 전용 UI 및 설정 관리.

### 📡 서버리스 API 핸들러 (`api/`)
- `explorer.js`: Lichess 오프닝 탐색기 API 프록시.
- `gemini.js`: Google Gemini AI 모델 통신 핸들러.
- `groq.js`: Groq AI 모델(Llama 등) 통신 핸들러.
- `lichess-proxy.js`: Lichess API 호출을 위한 범용 프록시.
- `lichess-token.js`: 환경 변수에서 Lichess 토큰을 안전하게 관리.

### 🤖 체스 엔진 (`stockfish/`)
- `stockfish-18-single.js`: Stockfish 18 WASM 인터페이스 스크립트.
- `stockfish-18-single.wasm`: 실제 브라우저에서 실행되는 **Stockfish 18 엔진 바이너리**.

---

## 🚀 시작하기

1. **환경 변수 설정**: Vercel 또는 로컬 환경에 아래 변수를 설정합니다.
   - `GEMINI_API_KEY`: Google AI Studio에서 발급
   - `GROQ_API_KEY`: Groq Cloud에서 발급
2. **Firebase 설정**: `.firebaserc` 및 `firebase.json`을 통해 본인의 Firebase 프로젝트와 연결합니다.
3. **배포**: Vercel 또는 Firebase Hosting을 통해 배포 가능합니다.

---

## 📄 라이선스
본 프로젝트는 교육적 목적으로 제작되었으며, Stockfish 등 오픈소스 라이브러리의 라이선스를 준수합니다.
