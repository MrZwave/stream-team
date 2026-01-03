async function trackProfileView(streamerLogin) {
    try {
        const referrer = document.referrer || "";
        const response = await fetch("/api/track-view", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ streamer_login: streamerLogin, referrer: referrer }),
        });
        const data = await response.json();
        if (data.success) {
            console.log(`✅ Vue enregistrée (source: ${data.source})`);
        } else {
            console.warn("⚠️ Erreur tracking:", data.error);
        }
    } catch (error) {
        console.error("❌ Erreur lors du tracking de la vue:", error);
    }
}
async function trackSalve(fromLogin, toLogin) {
    try {
        const response = await fetch("/api/track-salve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from_login: fromLogin, to_login: toLogin }),
        });
        const data = await response.json();
        if (data.success) {
            console.log("✅ Salve enregistrée");
            return !0;
        } else {
            console.warn("⚠️ Erreur tracking salve:", data.error);
            return !1;
        }
    } catch (error) {
        console.error("❌ Erreur lors du tracking de la salve:", error);
        return !1;
    }
}
async function trackClipSave(streamerLogin, clipId) {
    try {
        const response = await fetch("/api/track-clip-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ streamer_login: streamerLogin, clip_id: clipId }),
        });
        const data = await response.json();
        if (data.success) {
            console.log("✅ Clip save tracké");
            return !0;
        }
    } catch (error) {
        console.error("❌ Erreur lors du tracking du clip:", error);
        return !1;
    }
}
document.addEventListener("DOMContentLoaded", function () {
    const profileObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.id === "profile-content" && mutation.target.style.display !== "none") {
                const usernameElement = document.getElementById("profile-username");
                if (usernameElement && usernameElement.textContent.startsWith("@")) {
                    const streamerLogin = usernameElement.textContent.replace("@", "");
                    trackProfileView(streamerLogin);
                    profileObserver.disconnect();
                }
            }
        });
    });
    const profileContent = document.getElementById("profile-content");
    if (profileContent) {
        profileObserver.observe(profileContent, { attributes: !0, attributeFilter: ["style"] });
    }
});
function setupSalveTracking() {
    const salveButton = document.querySelector('[data-action="send-salve"]');
    if (salveButton) {
        salveButton.addEventListener("click", async function (e) {
            e.preventDefault();
            const toLogin = document.getElementById("profile-username")?.textContent.replace("@", "");
            const fromLogin = document.querySelector("[data-user-login]")?.dataset.userLogin;
            if (fromLogin && toLogin) {
                const success = await trackSalve(fromLogin, toLogin);
                if (success) {
                    showNotification("Salve envoyée ! 🔥", "success");
                }
            }
        });
    }
}
function setupClipTracking() {
    document.addEventListener("click", function (e) {
        const clipSaveBtn = e.target.closest("[data-clip-id]");
        if (clipSaveBtn && clipSaveBtn.classList.contains("save-clip-btn")) {
            const clipId = clipSaveBtn.dataset.clipId;
            const streamerLogin = document.getElementById("profile-username")?.textContent.replace("@", "");
            if (clipId && streamerLogin) {
                trackClipSave(streamerLogin, clipId);
            }
        }
    });
}
window.addEventListener("load", () => {
    setupSalveTracking();
    setupClipTracking();
});
function showNotification(message, type = "info") {
    const notif = document.createElement("div");
    notif.className = `tracking-notification tracking-${type}`;
    notif.textContent = message;
    notif.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === "success" ? "#10b981" : "#3b82f6"};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
    document.body.appendChild(notif);
    setTimeout(() => {
        notif.style.animation = "slideOut 0.3s ease-out";
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}
const style = document.createElement("style");
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
console.log("📊 Système de tracking initialisé");
