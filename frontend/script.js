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

  async function checkAuth() {
    // try {
    //   const res = await fetchWithSession("/api/me");
    //   if (!res.ok) throw new Error("Non connecté");
    //   const user = await res.json();
    //   sessionUser = user;

    //   authButton.innerHTML = "⚙️ Options";
    //   if (profileBtn) profileBtn.href = `/profile.html?user=${user.login}`;
    //   if (dashboardBtn)
    //     dashboardBtn.href = `/dashboard.html?user=${user.login}`;

    authButton.onclick = (e) => {
      e.stopPropagation();
      const isOpen = dropdownMenu.style.display === "flex";
      dropdownMenu.style.display = isOpen ? "none" : "flex";
      authButton.classList.toggle("active", !isOpen);
      authButton.innerHTML = !isOpen
        ? '<span class="icon"><i class="fa-solid fa-xmark"></i></span>'
        : '<i class="fa-solid fa-gear"></i> Options';
    };

    document.addEventListener("click", (e) => {
      if (!dropdownWrapper.contains(e.target)) {
        dropdownMenu.style.display = "none";
      }
    });
    //   } catch {
    //     authButton.innerHTML = "Connexion Twitch";
    //     dropdownMenu.style.display = "none";
    //     authButton.onclick = () => {
    //       const popup = document.getElementById("loginPopup");
    //       if (popup) popup.classList.remove("hidden");
    //     };
    //   }
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
        window.location.href = `profile.html?user=${user.login}`;
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

  if (notifBtn && notifPanel) {
    notifBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      notifPanel.classList.toggle("show");

      if (notifPanel.classList.contains("show")) {
        // 1. Marquer comme lues
        try {
          await fetch("/api/notifications/mark-read", { method: "POST" });
        } catch (err) {
          console.warn("Erreur mark-read", err);
        }

        // 2. Recharger les notifications
        await loadNotifications();

        // 3. Cacher le point rouge
        if (notifDot) notifDot.style.display = "none";
      }
    });
    document.addEventListener("click", (e) => {
      if (!notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
        notifPanel.classList.remove("show");
      }
    });

    if (closeNotif) {
      closeNotif.addEventListener("click", (e) => {
        notifPanel.classList.remove("show");
      });
    }
  }

  async function checkNewNotifications() {
    try {
      const res = await fetch("/api/notifications");
      const notifs = await res.json();

      if (!Array.isArray(notifs)) {
        console.warn("⚠️ Les notifications ne sont pas un tableau", notifs);
        return;
      }

      const hasNew = notifs.some((n) => {
        // Cast le n.id en string pour éviter erreur si c'est un nombre
        const idStr = String(n.id);
        const isRealNotif = !idStr.startsWith("quest-");
        return isRealNotif && n.read === false;
      });

      if (notifDot) notifDot.style.display = hasNew ? "block" : "none";
    } catch (err) {
      console.error("Erreur check notifs:", err);
    }
  }

  // Vérifie à l'ouverture de la page
  checkNewNotifications();

  // Et toutes les 60s
  setInterval(checkNewNotifications, 60000);

  async function loadNotifications() {
    try {
      const res = await fetch("/api/notifications");
      const notifs = await res.json();
      const list = document.querySelector(".notif-list");
      list.innerHTML = "";

      // Trier les notifications les plus récentes en premier
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

      // Affiche le point rouge s'il y a du neuf
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
});
