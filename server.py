#!/usr/bin/env python3
"""
체스 분석 보드 — Stockfish 18 로컬 서버
=========================================
사용법:
  1. 이 파일(server.py)과 chess-wasm-fixed.html을 같은 폴더에 놓기
  2. stockfish 파일 다운로드 (아래 자동 다운로드 기능 참고)
  3. python server.py 실행
  4. 브라우저에서 http://localhost:8080 접속

필요한 파일 구조:
  ./
  ├── server.py
  ├── chess-wasm-fixed.html
  └── stockfish/
      ├── stockfish-18-single.js
      └── stockfish-18-single.wasm
"""

import http.server
import socketserver
import os
import sys
import urllib.request
import threading

PORT = 8080
STOCKFISH_DIR = "stockfish"
STOCKFISH_BASE = "https://unpkg.com/stockfish@18.0.0/src/"
STOCKFISH_FILES = [
    "stockfish-18-single.js",
    "stockfish-18-single.wasm",
]


def download_stockfish():
    """Stockfish 18 파일이 없으면 자동 다운로드"""
    os.makedirs(STOCKFISH_DIR, exist_ok=True)
    for filename in STOCKFISH_FILES:
        dest = os.path.join(STOCKFISH_DIR, filename)
        if os.path.exists(dest):
            print(f"  ✓ {filename} (이미 존재)")
            continue
        url = STOCKFISH_BASE + filename
        print(f"  ↓ {filename} 다운로드 중...")
        try:
            urllib.request.urlretrieve(url, dest)
            size_mb = os.path.getsize(dest) / 1024 / 1024
            print(f"  ✓ {filename} ({size_mb:.1f} MB)")
        except Exception as e:
            print(f"  ✗ {filename} 다운로드 실패: {e}")
            print(f"    수동으로 다운로드하세요: {url}")


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    """CORS + SharedArrayBuffer에 필요한 헤더를 추가하는 핸들러"""

    def end_headers(self):
        # CORS
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        # SharedArrayBuffer 활성화 (멀티스레드 WASM에 필요)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def guess_type(self, path):
        # wasm MIME 타입 명시
        if path.endswith(".wasm"):
            return "application/wasm"
        return super().guess_type(path)

    def log_message(self, format, *args):
        # 간결한 로그
        msg = format % args
        if "200" in msg or "304" in msg:
            print(f"  → {self.path}")
        else:
            print(f"  [요청] {msg}")


def main():
    print("=" * 50)
    print("  체스 분석 보드 — Stockfish 18 서버")
    print("=" * 50)

    # Stockfish 파일 확인 및 다운로드
    print("\n[1] Stockfish 18 파일 확인 중...")
    download_stockfish()

    # HTML 파일 확인
    if not os.path.exists("chess-wasm-fixed.html"):
        print("\n⚠️  chess-wasm-fixed.html 파일이 없습니다.")
        print("   server.py와 같은 폴더에 놓아주세요.")
        sys.exit(1)

    # 서버 시작
    print(f"\n[2] 서버 시작 중... (포트 {PORT})")
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    with socketserver.TCPServer(("", PORT), CORSHandler) as httpd:
        httpd.allow_reuse_address = True
        print(f"\n✅ 서버 실행 중!")
        print(f"   브라우저에서 열기: http://localhost:{PORT}/chess-wasm-fixed.html")
        print(f"\n   종료: Ctrl+C\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n서버 종료.")


if __name__ == "__main__":
    main()
