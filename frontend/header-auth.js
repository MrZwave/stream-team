(function () {
    "use strict";
    async function checkAuthStatus() {
        try {
            const response = await fetch("/api/auth/status", { credentials: "include" });
            if (response.ok) {
                const data = await response.json();
                return data.authenticated || !1;
            }
            return !1;
        } catch (error) {
            console.warn("Auth check failed:", error);
            return !1;
        }
    }
    async function setupHeader() {
        const navActions = document.querySelector(".nav-actions");
        if (!navActions) return;
        navActions.classList.remove("loading");
        const isAuthenticated = await checkAuthStatus();
        if (isAuthenticated) {
            navActions.innerHTML = `
        <button id="notifBtn" class="icon-btn" title="Notifications" aria-label="Notifications">
          <i class="fas fa-bell"></i>
          <span id="notifDot" class="notif-dot" style="display: none;"></span>
        </button>
        <button id="menuBtn" class="icon-btn" title="Menu" aria-label="Menu">
          <i class="fas fa-bars"></i>
        </button>
      `;
            attachHeaderListeners();
        } else {
            navActions.innerHTML = `
        <a href="/auth/twitch" class="btn-login">
          <i class="fab fa-twitch"></i>
          <span>Se connecter</span>
        </a>
      `;
        }
    }
    function attachHeaderListeners() {
        const notifBtn = document.getElementById("notifBtn");
        const notifPanel = document.getElementById("notifPanel");
        const closeNotif = document.getElementById("closeNotif");
        const menuBtn = document.getElementById("menuBtn");
        const menuDropdown = document.getElementById("menuDropdown");
        if (notifBtn && notifPanel) {
            notifBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                notifPanel.classList.toggle("show");
                if (menuDropdown) menuDropdown.classList.remove("show");
            });
            if (closeNotif) {
                closeNotif.addEventListener("click", function () {
                    notifPanel.classList.remove("show");
                });
            }
        }
        if (menuBtn && menuDropdown) {
            menuBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                menuDropdown.classList.toggle("show");
                if (notifPanel) notifPanel.classList.remove("show");
            });
        }
        document.addEventListener("click", function (e) {
            if (notifPanel && !notifPanel.contains(e.target) && !notifBtn?.contains(e.target)) {
                notifPanel.classList.remove("show");
            }
            if (menuDropdown && !menuDropdown.contains(e.target) && !menuBtn?.contains(e.target)) {
                menuDropdown.classList.remove("show");
            }
        });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupHeader);
    } else {
        setupHeader();
    }
})();
