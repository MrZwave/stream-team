document.addEventListener("DOMContentLoaded", () => {
    const albumDiv = document.getElementById("album");
    const boosterButton = document.createElement("button");
    boosterButton.textContent = "🎴 Ouvrir un Booster";
    boosterButton.className = "booster-button";
    boosterButton.disabled = !0;
    albumDiv.parentElement.insertBefore(boosterButton, albumDiv);
    (async function init() {
        try {
            const meRes = await fetch("/api/me", { credentials: "include" });
            if (!meRes.ok) {
                return (window.location.href = "/");
            }
            await fetch("/api/me/cards/check", { method: "GET", credentials: "include" });
            boosterButton.addEventListener("click", openBooster);
            await loadAlbum();
            await checkBoosterAvailable();
        } catch (err) {
            console.error("❌ Erreur init album.js:", err);
            albumDiv.innerHTML = "<p>🔥 Problème serveur. Réessayez plus tard.</p>";
        }
    })();
    async function loadAlbum() {
        try {
            const res = await fetch("/api/me/cards/collection", { credentials: "include" });
            if (res.status === 401) return (window.location.href = "/");
            const cards = await res.json();
            albumDiv.innerHTML = "";
            if (!cards.length) {
                albumDiv.innerHTML = "<p>🚀 Pas encore de cartes. Lance un stream !</p>";
                return;
            }
            const map = new Map();
            cards.forEach((c) => {
                if (!map.has(c.id)) {
                    c.count = 0;
                    map.set(c.id, c);
                }
                map.get(c.id).count++;
            });
            const grid = document.createElement("div");
            grid.className = "album-grid";
            for (const card of map.values()) {
                const d = document.createElement("div");
                d.className = `card-collection ${card.rarity.toLowerCase()}`;
                d.innerHTML = `
          <img src="${card.image_url}" alt="${card.name}">
          <div class="rarity-badge ${card.rarity.toLowerCase()}">
            ${card.rarity.toUpperCase()}
          </div>
          <h3>
            ${card.name}
            ${card.count > 1 ? `<span class="card-count">x${card.count}</span>` : ""}
          </h3>
          <p class="description">${card.description || ""}</p>
        `;
                grid.appendChild(d);
            }
            albumDiv.appendChild(grid);
        } catch (err) {
            console.error("❌ Erreur loadAlbum:", err);
            albumDiv.innerHTML = "<p>🔥 Impossible de charger l'album.</p>";
        }
    }
    async function checkBoosterAvailable() {
        try {
            const res = await fetch("/api/me/cards/booster-available", { credentials: "include" });
            const { available } = await res.json();
            boosterButton.disabled = !available;
        } catch (err) {
            boosterButton.disabled = !0;
        }
    }
    async function openBooster() {
        try {
            const res = await fetch("/api/me/cards/drop", { method: "POST", credentials: "include" });
            const data = await res.json();
            if (!res.ok || !data.success) {
                return showPopup(data.error || "🚫 Tirage impossible");
            }
            const drops = Array.isArray(data.drops) ? data.drops : [];
            const popup = document.createElement("div");
            popup.className = "booster-popup";
            popup.innerHTML = `<h2>🎁 Ton booster :</h2>`;
            drops.forEach((c) => {
                const d = document.createElement("div");
                d.className = `card-collection ${c.rarity.toLowerCase()}`;
                d.innerHTML = `
          <img src="${c.image_url}" alt="${c.name}">
          <div class="rarity-badge ${c.rarity.toLowerCase()}">
            ${c.rarity.toUpperCase()}
          </div>
          <h3>${c.name}</h3>
          <p class="description">${c.description || ""}</p>
        `;
                popup.appendChild(d);
            });
            const btn = document.createElement("button");
            btn.textContent = "OK";
            btn.className = "booster-button";
            btn.onclick = () => {
                popup.remove();
                loadAlbum();
                checkBoosterAvailable();
            };
            popup.appendChild(btn);
            document.body.appendChild(popup);
            new Audio("/assets/sounds/booster-open.mp3").play();
        } catch (err) {
            console.error("❌ Erreur openBooster:", err);
            showPopup("🔥 Erreur technique");
        }
    }
    function showPopup(msg) {
        const p = document.createElement("div");
        p.className = "message-popup";
        p.textContent = msg;
        document.body.appendChild(p);
        setTimeout(() => p.classList.add("visible"), 100);
        setTimeout(() => {
            p.classList.remove("visible");
            setTimeout(() => p.remove(), 300);
        }, 2000);
    }
});
