document.addEventListener("DOMContentLoaded", async () => {
  // ========================================
  // 🎨 HEADER UNIVERSEL
  // ========================================

  // Titre dynamique selon la page
  const pageTitles = {
    "/watch": '<i class="fas fa-video"></i> Lives en Direct',
    "/album": '<i class="fas fa-images"></i> Mon Album',
    "/roadmap": '<i class="fas fa-map"></i> Roadmap',
    "/home": '<i class="fas fa-home"></i> Accueil',
    "/contact": '<i class="fa-solid fa-envelope"></i> Contact',
    "/admin": '<i class="fa-solid fa-lock"></i> Admin',
    "/cgu": '<i class="fas fa-book"></i> CGU',
    "/mentions-legales": '<i class="fas fa-file-alt"></i> Mentions Légales',
    "/confidentialite": '<i class="fas fa-shield-alt"></i> Confidentialité',
    "/cookies": '<i class="fas fa-cookie-bite"></i> Cookies',
    "/contact": '<i class="fas fa-envelope"></i> Contact',
    "/streamer": '<i class="fas fa-user"></i> Mon Profil',
    "/": '<i class="fas fa-home"></i> Stream Team HQ',
  };

  const currentPath = window.location.pathname.replace(".html", "");
  const pageTitle = document.getElementById("pageTitle");
  if (pageTitle) {
    pageTitle.innerHTML = pageTitles[currentPath] || "Stream Team HQ";
  }

  // Elements du header universel
  const notifBtn = document.getElementById("notifBtn");
  const notifPanel = document.getElementById("notifPanel");
  const closeNotif = document.getElementById("closeNotif");
  const notifDot = document.getElementById("notifDot");
  const menuBtn = document.getElementById("menuBtn");
  const menuDropdown = document.getElementById("menuDropdown");
  const profileButton = document.getElementById("profileButton");

  // ========================================
  // 🔔 NOTIFICATIONS
  // ========================================

  if (notifBtn && notifPanel) {
    notifBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      notifPanel.classList.toggle("show");
      if (menuDropdown) menuDropdown.classList.remove("show");

      if (notifPanel.classList.contains("show")) {
        // Marquer comme lues
        try {
          await fetch("/api/notifications/mark-read", {
            method: "POST",
            credentials: "include",
          });
        } catch (err) {
          console.warn("Erreur mark-read", err);
        }

        // Recharger les notifications
        await loadNotifications();

        // Cacher le point rouge
        if (notifDot) notifDot.style.display = "none";
      }
    });

    if (closeNotif) {
      closeNotif.addEventListener("click", () => {
        notifPanel.classList.remove("show");
      });
    }
  }

  // ========================================
  // 📱 MENU DROPDOWN
  // ========================================

  if (menuBtn && menuDropdown) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle("show");
      if (notifPanel) notifPanel.classList.remove("show");
    });
  }

  // ========================================
  // 👤 BOUTON PROFIL
  // ========================================

  if (profileButton) {
    profileButton.addEventListener("click", async (e) => {
      e.preventDefault();

      try {
        const res = await fetch("/api/me", { credentials: "include" });

        if (res.ok) {
          const user = await res.json();
          window.location.href = `/streamer/${user.login}`;
        } else {
          // Non connecté
          window.location.href = "/auth/twitch";
        }
      } catch (err) {
        console.error("Erreur profil:", err);
        alert("Impossible de charger le profil");
      }
    });
  }

  // ========================================
  // 🖱️ FERMER AU CLIC EXTÉRIEUR
  // ========================================

  document.addEventListener("click", (e) => {
    if (
      notifPanel &&
      !notifPanel.contains(e.target) &&
      !notifBtn?.contains(e.target)
    ) {
      notifPanel.classList.remove("show");
    }
    if (
      menuDropdown &&
      !menuDropdown.contains(e.target) &&
      !menuBtn?.contains(e.target)
    ) {
      menuDropdown.classList.remove("show");
    }
  });

  // ========================================
  // 🔍 VÉRIFIER NOUVELLES NOTIFICATIONS
  // ========================================

  async function checkNewNotifications() {
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      const notifs = await res.json();

      if (!Array.isArray(notifs)) {
        console.warn("⚠️ Les notifications ne sont pas un tableau", notifs);
        return;
      }

      const hasNew = notifs.some((n) => {
        const idStr = String(n.id);
        const isRealNotif = !idStr.startsWith("quest-");
        return isRealNotif && n.read === false;
      });

      if (notifDot) notifDot.style.display = hasNew ? "block" : "none";
    } catch (err) {
      console.error("Erreur check notifs:", err);
    }
  }

  // ========================================
  // 📥 CHARGER NOTIFICATIONS
  // ========================================

  async function loadNotifications() {
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      const notifs = await res.json();
      const list = document.querySelector(".notif-list");

      if (!list) return;

      list.innerHTML = "";

      if (!notifs || notifs.length === 0) {
        list.innerHTML =
          '<p style="color: #94a3b8; padding: 20px; text-align: center;">Aucune notification</p>';
        return;
      }

      // Trier par date
      notifs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      notifs.forEach((n) => {
        const item = document.createElement("div");
        item.className = "notif-item";
        item.innerHTML = `
          <span class="notif-icon">${n.icon || "🔔"}</span>
          <div class="notif-content">
            <strong>${n.title || "Notification"}</strong><br>
            ${n.message}
            <small>${new Date(n.created_at).toLocaleString()} • ${
          n.category?.charAt(0).toUpperCase() + n.category?.slice(1)
        }</small>
          </div>
        `;
        list.appendChild(item);
      });
    } catch (err) {
      console.error("Erreur chargement notifications:", err);
    }
  }

  // Vérifier à l'ouverture
  checkNewNotifications();

  // Vérifier toutes les 60s
  setInterval(checkNewNotifications, 60000);

  // ========================================
  // 🎮 MENU ACTIF
  // ========================================

  // Mettre l'item actif dans le menu
  if (menuDropdown) {
    document.querySelectorAll(".dropdown-item").forEach((item) => {
      const href = item.getAttribute("href");
      if (href && (href === currentPath || href === currentPath + ".html")) {
        item.classList.add("active");
      }
    });
  }

  // ========================================
  // 🏠 HOME PAGE - STREAMERS (si présent)
  // ========================================

  const container = document.querySelector(".streamers");
  let sessionUser = null;

  function fetchWithSession(url, options = {}) {
    return fetch(url, {
      credentials: "include",
      ...options,
    });
  }

  async function checkAuth() {
    try {
      const res = await fetchWithSession("/api/me");
      if (!res.ok) throw new Error("Non connecté");
      const user = await res.json();
      sessionUser = user;

      // Si ancien système de auth-button existe
      const authButton = document.getElementById("auth-button");
      const dropdownMenu = document.getElementById("auth-dropdown");
      const profileBtn = document.getElementById("profileButton");
      const dashboardBtn = document.getElementById("dashboardButton");

      if (authButton) {
        authButton.innerHTML = "⚙️ Options";
        if (profileBtn) profileBtn.href = `/streamer/${user.login}`;
        if (dashboardBtn)
          dashboardBtn.href = `/dashboard.html?user=${user.login}`;

        authButton.onclick = (e) => {
          e.stopPropagation();
          if (dropdownMenu) {
            dropdownMenu.style.display =
              dropdownMenu.style.display === "flex" ? "none" : "flex";
          }
        };
      }
    } catch (err) {
      // Non connecté
      const authButton = document.getElementById("auth-button");
      if (authButton) {
        authButton.innerHTML = "Connexion Twitch";
        authButton.onclick = () => {
          const popup = document.getElementById("loginPopup");
          if (popup) popup.classList.remove("hidden");
        };
      }
    }
  }

  async function loadStreamTeam() {
    if (!container) return;

    try {
      const [streamerRes, liveRes] = await Promise.all([
        fetchWithSession("/api/streamers"),
        fetchWithSession("/api/live"),
      ]);

      const data = await streamerRes.json();
      const logins = data.streamers || [];
      const queryString = logins
        .map((s) => `login=${encodeURIComponent(s.login)}`)
        .join("&");

      const usersRes = await fetchWithSession("/api/users?" + queryString);
      const userData = await usersRes.json();
      const users = userData.data || [];

      const liveResponse = await liveRes.json();
      const liveData = liveResponse.liveData || [];

      renderCards(liveData, users);
    } catch (err) {
      container.innerHTML =
        '<p style="color: #f55">Erreur de chargement des streamers.</p>';
      console.error("[Erreur]", err);
    }
  }

  function renderCards(streams, users) {
    if (!container) return;

    container.innerHTML = "";
    const liveUsers = streams.map((s) => s.user_login);
    const sortedUsers = [...users].sort(
      (a, b) => liveUsers.includes(b.login) - liveUsers.includes(a.login)
    );

    sortedUsers.forEach((user) => {
      const isLive = liveUsers.includes(user.login);
      const stream = streams.find((s) => s.user_login === user.login);
      const card = document.createElement("div");
      card.className = `card scroll-animate${!isLive ? " offline" : ""}`;
      card.innerHTML = `
        <img src="${user.profile_image_url}" alt="${user.display_name}">
        <p><strong>${user.display_name}</strong></p>
        ${
          isLive
            ? `<p class="details">🎮 ${stream.game_name}</p>`
            : '<p class="details offline-text">📴 hors-ligne</p>'
        }
        ${isLive ? `<p class="details">🎧 ${stream.title}</p>` : ""}
        ${
          isLive
            ? `<p class="details">👥 ${stream.viewer_count} spectateurs</p>`
            : ""
        }
        ${
          isLive
            ? `<a href="https://twitch.tv/${user.login}" target="_blank">Regarder en direct</a>`
            : ""
        }
        ${isLive ? `<div class="badge">🔴 EN LIVE</div>` : ""}
      `;

      card.addEventListener("click", async () => {
        try {
          await fetchWithSession("/api/profile-click", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ login: user.login }),
          });
        } catch (err) {
          console.warn("Échec du comptage de clic", err);
        }
        window.location.href = `/streamer/${user.login}`;
      });

      container.appendChild(card);
    });
  }

  // ========================================
  // 🔐 POPUP CONNEXION
  // ========================================

  const loginBtn = document.getElementById("openLoginPopup");
  const popup = document.getElementById("loginPopup");

  if (loginBtn && popup) {
    loginBtn.addEventListener("click", () => {
      popup.classList.remove("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!popup.contains(e.target) && e.target !== loginBtn) {
        popup.classList.add("hidden");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        popup.classList.add("hidden");
      }
    });
  }

  // Helper CSRF
  function getCSRFToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : null;
  }

  async function secureFetch(url, options = {}) {
    const token = getCSRFToken();

    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (token) {
      headers["CSRF-Token"] = token;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    if (response.status === 403) {
      const data = await response.json();
      if (data.error && data.error.includes("CSRF")) {
        window.location.reload();
        return;
      }
    }

    return response;
  }

  // ========================================
  // 🚀 INITIALISATION
  // ========================================

  await checkAuth();

  if (container) {
    await loadStreamTeam();
    setInterval(loadStreamTeam, 30000);
  }
});
