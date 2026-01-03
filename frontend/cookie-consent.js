(function () {
    "use strict";
    const COOKIE_CONSENT_NAME = "cookieConsent";
    const COOKIE_DURATION = 365;
    function hasConsent() {
        return getCookie(COOKIE_CONSENT_NAME) !== null;
    }
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return JSON.parse(decodeURIComponent(parts.pop().split(";").shift()));
        }
        return null;
    }
    function setCookie(name, value, days) {
        const expires = new Date();
        expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
        document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
    }
    function savePreferences(preferences) {
        setCookie(COOKIE_CONSENT_NAME, preferences, COOKIE_DURATION);
        applyPreferences(preferences);
        console.log("[Cookies] Préférences sauvegardées:", preferences);
    }
    function initAnalytics() {
        if (window.gaInitialized) return;
        window.gaInitialized = !0;
        const GA_ID = "G-5N53QMW3B2";
        const s = document.createElement("script");
        s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
        s.async = !0;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        function gtag() {
            dataLayer.push(arguments);
        }
        window.gtag = gtag;
        gtag("js", new Date());
        gtag("config", GA_ID, { anonymize_ip: !0, cookie_flags: "SameSite=None;Secure" });
        console.log("[GA4] Initialisé avec ID:", GA_ID);
    }
    function removeAnalyticsCookies() {
        const cookies = document.cookie.split(";");
        cookies.forEach((cookie) => {
            const name = cookie.split("=")[0].trim();
            if (name.startsWith("_ga")) {
                document.cookie = `${name}=; Max-Age=0; path=/;`;
            }
        });
        console.log("[GA4] Cookies supprimés");
    }
    function applyPreferences(preferences) {
        if (preferences.performance) {
            console.log("[Cookies] Performance activé");
            initAnalytics();
        } else {
            console.log("[Cookies] Performance désactivé");
            removeAnalyticsCookies();
        }
        if (preferences.functional) {
            console.log("[Cookies] Fonctionnalité activé");
        } else {
            console.log("[Cookies] Fonctionnalité désactivé");
        }
    }
    function showBanner() {
        const banner = document.getElementById("cookieBanner");
        if (banner) {
            banner.style.display = "block";
        }
    }
    function hideBanner() {
        const banner = document.getElementById("cookieBanner");
        if (banner) {
            banner.style.display = "none";
        }
    }
    function showModal() {
        const modal = document.getElementById("cookieModal");
        if (modal) {
            modal.style.display = "flex";
            loadCurrentPreferences();
        }
    }
    function hideModal() {
        const modal = document.getElementById("cookieModal");
        if (modal) {
            modal.style.display = "none";
        }
    }
    function loadCurrentPreferences() {
        const consent = getCookie(COOKIE_CONSENT_NAME);
        if (consent) {
            document.getElementById("cookiePerformance").checked = consent.performance || !0;
            document.getElementById("cookieFunctional").checked = consent.functional || !0;
        }
    }
    function getModalPreferences() {
        return {
            essential: !0,
            performance: document.getElementById("cookiePerformance").checked,
            functional: document.getElementById("cookieFunctional").checked,
            timestamp: new Date().toISOString(),
        };
    }
    function acceptAll() {
        const preferences = { essential: !0, performance: !0, functional: !0, timestamp: new Date().toISOString() };
        savePreferences(preferences);
        hideBanner();
        hideModal();
    }
    function declineOptional() {
        const preferences = { essential: !0, performance: !1, functional: !1, timestamp: new Date().toISOString() };
        savePreferences(preferences);
        hideBanner();
    }
    function saveCustomPreferences() {
        const preferences = getModalPreferences();
        savePreferences(preferences);
        hideModal();
        hideBanner();
    }
    function toggleDetails(button) {
        const targetId = button.getAttribute("data-target");
        const details = document.getElementById(targetId);
        const icon = button.querySelector("i");
        if (details.style.display === "none" || !details.style.display) {
            details.style.display = "block";
            button.classList.add("open");
            icon.classList.remove("fa-chevron-down");
            icon.classList.add("fa-chevron-up");
        } else {
            details.style.display = "none";
            button.classList.remove("open");
            icon.classList.remove("fa-chevron-up");
            icon.classList.add("fa-chevron-down");
        }
    }
    function init() {
        if (!hasConsent()) {
            showBanner();
        } else {
            const consent = getCookie(COOKIE_CONSENT_NAME);
            applyPreferences(consent);
        }
        const acceptBtn = document.getElementById("cookieAccept");
        if (acceptBtn) {
            acceptBtn.addEventListener("click", acceptAll);
        }
        const declineBtn = document.getElementById("cookieDecline");
        if (declineBtn) {
            declineBtn.addEventListener("click", declineOptional);
        }
        const customizeBtn = document.getElementById("cookieCustomize");
        if (customizeBtn) {
            customizeBtn.addEventListener("click", showModal);
        }
        const closeModalBtn = document.getElementById("closeCookieModal");
        if (closeModalBtn) {
            closeModalBtn.addEventListener("click", hideModal);
        }
        const saveBtn = document.getElementById("cookieSavePreferences");
        if (saveBtn) {
            saveBtn.addEventListener("click", saveCustomPreferences);
        }
        const acceptAllBtn = document.getElementById("cookieAcceptAll");
        if (acceptAllBtn) {
            acceptAllBtn.addEventListener("click", acceptAll);
        }
        const settingsBtn = document.getElementById("cookieSettings");
        if (settingsBtn) {
            settingsBtn.addEventListener("click", showModal);
        }
        const toggleButtons = document.querySelectorAll(".cookie-toggle");
        toggleButtons.forEach((button) => {
            button.addEventListener("click", function () {
                toggleDetails(this);
            });
        });
        const modal = document.getElementById("cookieModal");
        if (modal) {
            modal.addEventListener("click", function (e) {
                if (e.target === modal) {
                    hideModal();
                }
            });
        }
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") {
                hideModal();
            }
        });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
    window.cookieConsent = {
        show: showBanner,
        hide: hideBanner,
        showSettings: showModal,
        hasConsent: hasConsent,
        getPreferences: () => getCookie(COOKIE_CONSENT_NAME),
    };
})();
