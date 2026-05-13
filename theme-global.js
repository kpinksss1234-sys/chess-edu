/**
 * 전역 라이트/다크 테마 — 모든 페이지 공통 (theme-ui.css 의 data-color-mode 와 연동)
 */
(function () {
  var KEY = 'chess_education_color_mode';

  function stored() {
    try {
      var t = localStorage.getItem(KEY);
      return t === 'light' || t === 'dark' ? t : 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function clearInlineThemeOverrides() {
    var props = [
      '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-card', '--bg-hover',
      '--border', '--border-light', '--text-primary', '--text-secondary', '--text-muted'
    ];
    for (var i = 0; i < props.length; i++) {
      try {
        document.documentElement.style.removeProperty(props[i]);
      } catch (e) { /* ignore */ }
    }
  }

  function applyTheme(mode) {
    var m = mode === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-color-mode', m);
    clearInlineThemeOverrides();
    try {
      localStorage.setItem(KEY, m);
    } catch (e) { /* private mode */ }
  }

  function toggleColorMode() {
    var cur = document.documentElement.getAttribute('data-color-mode') === 'light' ? 'light' : 'dark';
    var next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    if (typeof showToast === 'function') {
      showToast(next === 'light' ? '라이트 모드' : '다크 모드');
    }
  }

  window.toggleColorMode = toggleColorMode;
  window.applyStoredColorMode = function () { applyTheme(stored()); };

  applyTheme(stored());
})();
