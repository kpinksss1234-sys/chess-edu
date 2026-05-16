/**
 * sidebar-component.js
 * 모든 페이지에서 공통으로 사용하는 사이드바를 동적으로 로드합니다.
 */
(function() {
  const sidebarHTML = `
    <a class="sidebar-logo" href="/" title="홈">♟</a>
    <div class="sidebar-nav">
      <a class="sidebar-item" id="nav-analysis" href="/" title="분석">
        <div class="sidebar-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM9 17H7V10H9V17ZM13 17H11V7H13V17ZM17 17H15V13H17V17Z"/></svg></div>
        <span class="sidebar-label">분석</span>
      </a>
      <a class="sidebar-item" id="nav-play" href="/play.html" title="온라인 대국">
        <div class="sidebar-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg></div>
        <span class="sidebar-label">대국</span>
      </a>
      <a class="sidebar-item" id="nav-puzzle" href="/puzzle.html" title="퍼즐 훈련">
        <div class="sidebar-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg></div>
        <span class="sidebar-label">퍼즐</span>
      </a>
      <a class="sidebar-item" id="nav-explorer" href="/opening-explorer.html" title="오프닝 탐색기">
        <div class="sidebar-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></div>
        <span class="sidebar-label">탐색기</span>
      </a>
      <div class="sidebar-divider"></div>
      <a class="sidebar-item" id="nav-records" href="/records.html" title="기록">
        <div class="sidebar-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20ZM8 15V17H16V15H8ZM8 11V13H16V11H8Z"/></svg></div>
        <span class="sidebar-label">기록</span>
      </a>
      <a class="sidebar-item" id="nav-study" href="/study.html" title="학습">
        <div class="sidebar-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg></div>
        <span class="sidebar-label">학습</span>
      </a>
      <a class="sidebar-item" id="nav-practice" href="/practice.html" title="엔진 연습">
        <div class="sidebar-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5v14h2v2h10v-2h2V5zm-2 12H7V7h10v10zM9 9h6v6H9V9z"/></svg></div>
        <span class="sidebar-label">연습</span>
      </a>
    </div>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="sidebar-avatar" id="sidebar-avatar-letter">?</div>
        <div class="sidebar-username" id="sidebar-username">로딩중</div>
      </div>
      <div class="sidebar-item" title="테마 변경" onclick="toggleColorMode()">
        <div class="sidebar-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 8.69V4H15.31L12 0.69L8.69 4H4V8.69L0.69 12L4 15.31V20H8.69L12 23.31L15.31 20H20V15.31L23.31 12L20 8.69ZM12 18C8.69 18 6 15.31 6 12C6 8.69 8.69 6 12 6C15.31 6 18 8.69 18 12C18 15.31 15.31 18 12 18Z"/></svg></div>
        <span class="sidebar-label">테마</span>
      </div>
      <div class="sidebar-item logout-btn" title="로그아웃" onclick="handleLogout()">
        <div class="sidebar-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></div>
        <span class="sidebar-label">로그아웃</span>
      </div>
    </div>
  `;

  function initSidebar() {
    const sidebarEl = document.getElementById('sidebar');
    if (!sidebarEl) return;

    sidebarEl.innerHTML = sidebarHTML;

    // 현재 페이지 활성화 표시
    const path = window.location.pathname;
    if (path === '/' || path.endsWith('index.html')) {
      document.getElementById('nav-analysis')?.classList.add('active');
    } else if (path.includes('play.html')) {
      document.getElementById('nav-play')?.classList.add('active');
    } else if (path.includes('puzzle.html')) {
      document.getElementById('nav-puzzle')?.classList.add('active');
    } else if (path.includes('opening-explorer.html')) {
      document.getElementById('nav-explorer')?.classList.add('active');
    } else if (path.includes('records.html')) {
      document.getElementById('nav-records')?.classList.add('active');
    } else if (path.includes('study')) {
      document.getElementById('nav-study')?.classList.add('active');
    } else if (path.includes('practice.html')) {
      document.getElementById('nav-practice')?.classList.add('active');
    }

    // Firebase 유저 정보 연동 (auth-check.js 의존)
    if (typeof firebase !== 'undefined') {
      firebase.auth().onAuthStateChanged(user => {
        const nameEl = document.getElementById('sidebar-username');
        const avEl = document.getElementById('sidebar-avatar-letter');
        if (user) {
          const name = user.displayName || user.email.split('@')[0];
          if (nameEl) nameEl.textContent = name;
          if (avEl) avEl.textContent = name[0].toUpperCase();
        } else {
          if (nameEl) nameEl.textContent = '게스트';
          if (avEl) avEl.textContent = '?';
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
  } else {
    initSidebar();
  }
})();
