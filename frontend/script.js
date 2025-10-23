document.addEventListener("DOMContentLoaded", async () => {
  // AUTHENTIFICATION
  const authButton = document.getElementById("auth-button");
  const dropdownMenu = document.getElementById("auth-dropdown");
  const dropdownWrapper = document.getElementById("auth-wrapper");
  const profileBtn = document.getElementById("profileButton");
  const dashboardBtn = document.getElementById("dashboardButton");
  const container = document.querySelector(".streamers");
  let sessionUser = null;

  function fetchWithSession(url, options = {}) {
    return fetch(url, {
      credentials: "include",
      ...options,
    });
  }

  function handleResize() {
    const widthScreen = window.innerWidth;

    if (widthScreen < 800) {
      authButton.style.display = "block";
      dropdownMenu.style.display = "none";

      authButton.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdownMenu.style.display === "flex";
        dropdownMenu.style.display = isOpen ? "none" : "flex";
        authButton.classList.toggle("active", !isOpen);
        authButton.innerHTML = !isOpen
          ? '<span class="icon"><i class="fa-solid fa-xmark"></i></span>'
          : '<i class="fa-solid fa-bars"></i>';
      };

      document.addEventListener("click", (e) => {
        if (dropdownWrapper && !dropdownWrapper.contains(e.target)) {
          dropdownMenu.style.display = "none";
        }
      });
    } else {
      authButton.style.display = "none";
      dropdownMenu.style.display = "flex";
    }
  }

  if (authButton && dropdownMenu) {
    handleResize();
    window.addEventListener("resize", handleResize);
  }

  async function checkAuth() {
    const connect = document.getElementById("connect");
    if (!connect) return;

    try {
      const res = await fetch("/api/auth/check", { credentials: "include" });

      if (res.ok) {
        connect.innerHTML = `<span><i class="fa-solid fa-arrow-right-from-bracket"></i></span> Déconnexion`;
      } else {
        connect.innerHTML = `<span><i class="fa-solid fa-arrow-right-from-bracket"></i></span> Connexion`;
      }
    } catch (error) {
      console.error("Erreur lors de la vérification auth:", error);
      connect.innerHTML = `<span><i class="fa-solid fa-arrow-right-from-bracket"></i></span> Connexion`;
    }
  }

  // STREAMERS
  async function loadStreamTeam() {
    if (!container) return;
    try {
      const [streamerRes, liveRes] = await Promise.all([
        fetchWithSession("/api/streamers"),
        fetchWithSession("/api/live"),
      ]);

      const logins = await streamerRes.json();
      const liveData = await liveRes.json();
      const queryString = logins
        .map((login) => `login=${encodeURIComponent(login)}`)
        .join("&");

      const usersRes = await fetchWithSession("/api/users?" + queryString);
      const userData = await usersRes.json();
      const users = userData.data || [];

      renderCards(liveData.liveData || [], users);
    } catch (err) {
      container.innerHTML =
        '<p style="color: #f55">Erreur de chargement des streamers.</p>';
      console.error("[Erreur]", err);
    }
  }
}

  function renderCards(streams, users) {
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

  // POPUP CONNEXION
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

  // NOTIFICATIONS
  const notifBtn = document.getElementById("notifBtn");
  const notifPanel = document.getElementById("notifPanel");
  const closeNotif = document.getElementById("closeNotif");
  const notifDot = document.getElementById("notifDot");

  function closeNotificationPanel() {
    if (notifPanel) notifPanel.classList.remove("show");
  }

  if (notifBtn && notifPanel) {
    notifBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      notifPanel.classList.add("show");

      if (notifPanel.classList.contains("show")) {
        try {
          await fetch("/api/notifications/mark-read", {
            method: "POST",
            credentials: "include",
          });
        } catch (err) {
          console.warn("Erreur mark-read", err);
        }

        await loadNotifications();

        if (notifDot) notifDot.style.display = "none";
      }
    });

    document.addEventListener("click", (e) => {
      if (!notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
        closeNotificationPanel();
      }
    });

    if (closeNotif) {
      closeNotif.addEventListener("click", (e) => {
        e.stopPropagation();
        closeNotificationPanel();
      });
    }
  }

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

  async function loadNotifications() {
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      const notifs = await res.json();
      const list = document.querySelector(".notif-list");
      if (!list) return;

      list.innerHTML = "";

      notifs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      let hasNew = false;

      notifs.forEach((n) => {
        const isNew =
          Date.now() - new Date(n.created_at).getTime() < 48 * 3600 * 1000;
        if (isNew) hasNew = true;

        const item = document.createElement("div");
        item.className = "notif-item";
        item.innerHTML = `
          <span class="notif-icon">${n.icon || "🔔"}</span>
          <div class="notif-content">
            <strong>${n.title || "Notification"}</strong><br>
            ${n.message}
            <small>${new Date(n.created_at).toLocaleString()} • ${
          n.category.charAt(0).toUpperCase() + n.category.slice(1)
        }</small>
          </div>
        `;
        list.appendChild(item);
      });

      if (notifDot) {
        notifDot.style.display = hasNew ? "block" : "none";
      }
    } catch (err) {
      console.error("Erreur chargement des notifications :", err);
    }
  }

  // LANCEMENT
  await checkAuth();

  if (container) {
    await loadStreamTeam();
    setInterval(loadStreamTeam, 30000);
  }

  if (notifBtn) {
    checkNewNotifications();
    setInterval(checkNewNotifications, 60000);
  }
});

// -------------------------------------------------------------------
// Code LukDum

// Mode sombre ou clair
function darkLight() {
  document.body.classList.toggle("light");
}

// Inscription
async function addUser(user) {
  try {
    const request = await fetch(`/api/user/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(user),
    });

    return await request.json();
  } catch (error) {
    console.error("Erreur lors de l'ajout:", error.message);
    return { success: false, error: error.message };
  }
}

if (document.getElementById("registerForm")) {
  document
    .getElementById("registerForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      const user = {
        email: document.getElementById("email").value,
        password: document.getElementById("password").value,
      };

      const result = await addUser(user);

      if (result.success) {
        alert("Inscription réussie ! Vous pouvez maintenant vous connecter.");
        window.location.href = "/login.html";
      } else {
        alert("Erreur : " + (result.error || "Impossible de créer le compte"));
      }
    });
}

// Connexion
async function loginUser(credentials) {
  try {
    console.log("🔵 Envoi de la requête de connexion...");

    const response = await fetch("/api/user/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(credentials),
    });

    console.log("📡 Status:", response.status);

    const data = await response.json();
    console.log("📦 Réponse:", data);

    if (!response.ok) {
      throw new Error(data.error || "Erreur de connexion");
    }

    return data;
  } catch (error) {
    console.error("❌ Erreur:", error);
    return { success: false, error: error.message };
  }
}

if (document.getElementById("loginForm")) {
  const loginForm = document.getElementById("loginForm");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    console.log("✅ Formulaire intercepté par JavaScript");

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;

    submitBtn.disabled = true;
    submitBtn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Connexion...';

    const credentials = {
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    };

    console.log("📧 Email:", credentials.email);

    const result = await loginUser(credentials);

    if (result.success) {
      console.log("✅ Connexion réussie!");
      submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Connecté!';

      setTimeout(() => {
        window.location.href = "/index.html";
      }, 500);
    } else {
      console.error("❌ Échec:", result.error);
      alert("❌ " + (result.error || "Impossible de se connecter"));

      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });

  console.log("✅ Gestionnaire de formulaire de connexion installé");
}

// Vérifier session
async function checkSession() {
  const response = await fetch("/api/user/check", {
    method: "GET",
    credentials: "include",
  });
  const data = await response.json();
  console.log("🔎 Session check:", data);
  return data.loggedIn;
}

checkSession().then((isLoggedIn) => {
  if (isLoggedIn) {
    console.log("✅ Utilisateur toujours connecté");
  } else {
    console.log("🔴 Utilisateur déconnecté");
    window.location.href = "/login.html";
  }
});
