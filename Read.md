# ♟️ Chess Education & Analysis Board

Stockfish 18 WASM 엔진을 활용한 웹 기반 체스 분석 플랫폼입니다. 인공지능 엔진을 통해 체스 기보를 분석하고 전략적인 조언을 제공합니다.

## 🚀 주요 기능

* **최신 엔진 탑재:** Stockfish 18 Single Thread WASM 버전을 활용한 고성능 분석
* **실시간 분석:** 현재 국면에 대한 최선의 수(Best Move) 및 평가치 제공
* **자연어 코칭:** 분석 결과를 바탕으로 한 전략 및 계획 제시
* **반응형 UI:** 다크 모드를 지원하는 현대적인 웹 인터페이스

---

## 🌐 배포 및 업데이트 방법 (Firebase Hosting)

본 프로젝트는 **Firebase Hosting**을 통해 호스팅되고 있습니다. 아래 절차에 따라 배포 및 업데이트를 진행할 수 있습니다.

### 1. Firebase CLI 설치 (처음 한 번만)

Node.js 환경에서 다음 명령어를 실행하여 도구를 설치합니다.

```bash
npm install -g firebase-tools

```

### 2. 로그인

구글 계정 인증을 통해 로그인을 진행합니다.

```bash
firebase login

```

*브라우저가 열리면 해당 구글 계정으로 로그인하세요.*

### 3. 배포 및 업데이트

파일 수정 후 `firebase.json`이 있는 프로젝트 루트 폴더에서 다음 명령어를 실행합니다.

```bash
firebase deploy --only hosting

```

* **완료 시 주소:** [chess-education-464fc.web.app](https://www.google.com/search?q=https://chess-education-464fc.web.app)
* 매번 코드를 업데이트할 때는 **3번 과정**만 반복하면 자동으로 서버에 반영됩니다.

---

## 🛠 기술 스택

* **Frontend:** HTML5, CSS3, JavaScript (ES6+)
* **Engine:** Stockfish 18 WASM
* **Infrastructure:** Firebase Hosting, GitHub Actions (Auto-deploy)

---

## 📂 폴더 구조

* `auth.html`: 로그인,회원가입 페이지
* `chess-wasm-fixed.html`: 메인 분석 보드 페이지
* `stockfish/`: Stockfish 엔진 관련 `.js` 및 `.wasm` 파일
* `firebase.json`: 호스팅 설정 및 COOP/COEP 헤더 설정 파일

---

### 💡 팁: GitHub 자동 배포

현재 GitHub Actions가 설정되어 있어, `main` 브랜치에 `git push`를 하는 것만으로도 Firebase에 자동 배포가 이루어지도록 구성되어 있습니다.

---