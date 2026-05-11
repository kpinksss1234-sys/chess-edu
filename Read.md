# 체스 교육 플랫폼 (Chess Education Project)

본 프로젝트는 온라인 체스 학습 및 실시간 대국을 위한 웹 기반 플랫폼입니다. Firebase를 활용한 사용자 인증과 Stockfish 엔진을 통한 강력한 체스 분석 기능을 제공합니다.

---

## 🚀 주요 기능
- **온라인 대국**: 랜덤 매칭을 통한 실시간 1대1 체스 대국.
- **체스 퍼즐**: 다양한 난이도의 체스 퍼즐 훈련.
- **오프닝 탐색기**: 체스 오프닝 이론 학습 및 탐색.
- **학습 모드**: 오프닝 및 엔드게임 집중 학습.
- **분석 도구**: Stockfish 엔진을 활용한 기보 분석 및 연습.
- **기록 및 통계**: 대국 기록 저장 및 게임 통계 확인.

---

## 🛠 기술 스택
- **프론트엔드**: HTML, Vanilla CSS, JavaScript
- **백엔드**: Firebase (Authentication, Firestore, Realtime Database)
- **체스 엔진**: Stockfish (WASM 기반)

---

## 📂 파일 및 디렉토리 역할

### 핵심 페이지 (HTML)
- `play.html`: 실시간 온라인 대국을 진행하는 메인 화면.
- `puzzle.html`: 퍼즐 모드 및 연습 페이지.
- `opening-explorer.html`: 체스 오프닝 탐색 및 학습.
- `study.html`, `study-opening.html`, `study-endgame.html`: 이론 학습을 위한 페이지들.
- `practice.html`: 엔진 연습 모드.
- `records.html`: 사용자의 게임 기록 및 통계 확인.
- `auth.html`: 사용자 로그인 및 회원가입 페이지.
- `chess-wasm-fixed.html`: 엔진 기반의 강력한 분석 보드.

### 핵심 스크립트 및 API
- `auth-check.js`: **[중요]** 전역 인증 로직. Firebase 초기화, 로그인 상태 감지 및 미로그인 시 리다이렉션, 전역 로그아웃 함수(`handleLogout`)를 관리합니다.
- `api/`: 백엔드 관련 로직.
    - `explorer.js`: 오프닝 데이터 탐색 API.
    - `groq.js`, `lichess-proxy.js`, `lichess-token.js`: 외부 서비스 연동 및 통신용.
- `chess-wasm-fixed/`: 엔진 및 분석 보드 관련 핵심 로직 모듈.
- `records/`: 게임 기보 분석 및 통계 계산 로직.
- `stockfish/`: Stockfish WASM 바이너리 및 실행 스크립트.
- `sound/`: 대국 중 발생하는 사운드 에셋.

---

## ⚙️ 인증 시스템
중앙 집중식 인증 관리(`auth-check.js`)를 통해 모든 페이지에서 동일한 사용자 세션 관리 및 로그아웃 기능을 보장합니다. 로그아웃이 필요한 모든 페이지는 해당 스크립트를 로드하며, HTML 내의 `onclick="handleLogout()"` 버튼을 통해 동작합니다.
