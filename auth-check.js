(function() {
  // Firebase configuration
  const firebaseConfig = {
    apiKey: "AIzaSyDiBFoUf2QVG9QXO34Xny0bSslFYaiwozg",
    authDomain: "chess-education-464fc.firebaseapp.com",
    projectId: "chess-education-464fc",
    storageBucket: "chess-education-464fc.firebasestorage.app",
    messagingSenderId: "963998720041",
    appId: "1:963998720041:web:aa4037707214d3777c7c38",
    databaseURL: "https://chess-education-464fc-default-rtdb.firebaseio.com"
  };

  // Initialize Firebase if not already initialized
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    // Expose Firebase services globally
    window._auth = firebase.auth();
    window._fbAuth = firebase.auth();
    if (typeof firebase.firestore === 'function') window._fbDb = firebase.firestore();
    if (typeof firebase.database === 'function') window._rtDb = firebase.database();

    // Authentication state observer
    window._auth.onAuthStateChanged(function(user) {
      checkAuth(user);
    });

    // Back-button navigation check
    window.addEventListener('pageshow', function(event) {
      if (event.persisted || window._auth.currentUser === null) {
        checkAuth(window._auth.currentUser);
      }
    });

    function checkAuth(user) {
      const path = window.location.pathname;
      const isAuthPage = path.endsWith('auth.html');

      if (user) {
        window._user = user;
        window._currentUser = user;
        
        const name = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
        
        // Update Sidebar UI (Common across many pages)
        const avatarEl = document.getElementById('sidebar-avatar-letter');
        const nameEl = document.getElementById('sidebar-username');
        if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
        if (nameEl) nameEl.textContent = name;
        
        // Update Play page specific elements
        const myAvatarEl = document.getElementById('my-avatar-el');
        const myNameEl = document.getElementById('my-name-el');
        if (myAvatarEl) myAvatarEl.textContent = name[0].toUpperCase();
        if (myNameEl) myNameEl.textContent = name;

        // Redirect from auth page if already logged in
        if (isAuthPage) {
          window.location.href = '/chess-wasm-fixed.html';
        }
      } else {
        // Redirect to auth page if not logged in
        if (!isAuthPage) {
          window.location.href = '/auth.html';
        }
      }
    }

    // Global logout handler
    window.handleLogout = function() {
      window._auth.signOut().then(function() {
        window.location.href = '/auth.html';
      }).catch(function(error) {
        console.error('Logout failed:', error);
      });
    };
  } else {
    console.error('Firebase SDK not loaded. Please include firebase-app-compat.js and firebase-auth-compat.js before auth-check.js');
  }
})();
