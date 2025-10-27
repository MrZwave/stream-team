/* ========================================
   🍪 GESTION DES COOKIES RGPD
   Script de consentement et gestion des préférences
   ======================================== */

(function() {
  'use strict';
  
  const COOKIE_CONSENT_NAME = 'cookieConsent';
  const COOKIE_DURATION = 365; // jours
  
  // Vérifier si le consentement existe déjà
  function hasConsent() {
    return getCookie(COOKIE_CONSENT_NAME) !== null;
  }
  
  // Récupérer un cookie
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      return JSON.parse(decodeURIComponent(parts.pop().split(';').shift()));
    }
    return null;
  }
  
  // Créer un cookie
  function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
  }
  
  // Sauvegarder les préférences
  function savePreferences(preferences) {
    setCookie(COOKIE_CONSENT_NAME, preferences, COOKIE_DURATION);
    applyPreferences(preferences);
    console.log('[Cookies] Préférences sauvegardées:', preferences);
  }
  
  // Appliquer les préférences
  function applyPreferences(preferences) {
    // Cookies essentiels (toujours actifs)
    // Rien à faire, ils sont déjà en place
    
    // Cookies de performance
    if (preferences.performance) {
      // Activer Google Analytics ou autre
      console.log('[Cookies] Performance activé');
      // initAnalytics();
    } else {
      console.log('[Cookies] Performance désactivé');
    }
    
    // Cookies de fonctionnalité
    if (preferences.functional) {
      console.log('[Cookies] Fonctionnalité activé');
      // Activer les préférences de thème, langue, etc.
    } else {
      console.log('[Cookies] Fonctionnalité désactivé');
    }
  }
  
  // Afficher la bannière
  function showBanner() {
    const banner = document.getElementById('cookieBanner');
    if (banner) {
      banner.style.display = 'block';
    }
  }
  
  // Masquer la bannière
  function hideBanner() {
    const banner = document.getElementById('cookieBanner');
    if (banner) {
      banner.style.display = 'none';
    }
  }
  
  // Afficher la modal
  function showModal() {
    const modal = document.getElementById('cookieModal');
    if (modal) {
      modal.style.display = 'flex';
      loadCurrentPreferences();
    }
  }
  
  // Masquer la modal
  function hideModal() {
    const modal = document.getElementById('cookieModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }
  
  // Charger les préférences actuelles dans la modal
  function loadCurrentPreferences() {
    const consent = getCookie(COOKIE_CONSENT_NAME);
    if (consent) {
      document.getElementById('cookiePerformance').checked = consent.performance || false;
      document.getElementById('cookieFunctional').checked = consent.functional || false;
    }
  }
  
  // Lire les préférences depuis la modal
  function getModalPreferences() {
    return {
      essential: true, // Toujours vrai
      performance: document.getElementById('cookiePerformance').checked,
      functional: document.getElementById('cookieFunctional').checked,
      timestamp: new Date().toISOString()
    };
  }
  
  // Accepter tous les cookies
  function acceptAll() {
    const preferences = {
      essential: true,
      performance: true,
      functional: true,
      timestamp: new Date().toISOString()
    };
    savePreferences(preferences);
    hideBanner();
    hideModal();
  }
  
  // Refuser les cookies optionnels
  function declineOptional() {
    const preferences = {
      essential: true,
      performance: false,
      functional: false,
      timestamp: new Date().toISOString()
    };
    savePreferences(preferences);
    hideBanner();
  }
  
  // Sauvegarder les préférences personnalisées
  function saveCustomPreferences() {
    const preferences = getModalPreferences();
    savePreferences(preferences);
    hideModal();
    hideBanner();
  }
  
  // Toggle détails d'une catégorie
  function toggleDetails(button) {
    const targetId = button.getAttribute('data-target');
    const details = document.getElementById(targetId);
    const icon = button.querySelector('i');
    
    if (details.style.display === 'none' || !details.style.display) {
      details.style.display = 'block';
      button.classList.add('open');
      icon.classList.remove('fa-chevron-down');
      icon.classList.add('fa-chevron-up');
    } else {
      details.style.display = 'none';
      button.classList.remove('open');
      icon.classList.remove('fa-chevron-up');
      icon.classList.add('fa-chevron-down');
    }
  }
  
  // Initialisation
  function init() {
    // Si pas de consentement, afficher la bannière
    if (!hasConsent()) {
      showBanner();
    } else {
      // Appliquer les préférences existantes
      const consent = getCookie(COOKIE_CONSENT_NAME);
      applyPreferences(consent);
    }
    
    // Event listeners
    
    // Bouton Accepter (bannière)
    const acceptBtn = document.getElementById('cookieAccept');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', acceptAll);
    }
    
    // Bouton Refuser (bannière)
    const declineBtn = document.getElementById('cookieDecline');
    if (declineBtn) {
      declineBtn.addEventListener('click', declineOptional);
    }
    
    // Bouton Personnaliser (bannière)
    const customizeBtn = document.getElementById('cookieCustomize');
    if (customizeBtn) {
      customizeBtn.addEventListener('click', showModal);
    }
    
    // Bouton Fermer modal
    const closeModalBtn = document.getElementById('closeCookieModal');
    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', hideModal);
    }
    
    // Bouton Sauvegarder préférences (modal)
    const saveBtn = document.getElementById('cookieSavePreferences');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveCustomPreferences);
    }
    
    // Bouton Tout accepter (modal)
    const acceptAllBtn = document.getElementById('cookieAcceptAll');
    if (acceptAllBtn) {
      acceptAllBtn.addEventListener('click', acceptAll);
    }
    
    // Bouton paramètres flottant
    const settingsBtn = document.getElementById('cookieSettings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', showModal);
    }
    
    // Toggles pour détails des catégories
    const toggleButtons = document.querySelectorAll('.cookie-toggle');
    toggleButtons.forEach(button => {
      button.addEventListener('click', function() {
        toggleDetails(this);
      });
    });
    
    // Fermer la modal en cliquant à l'extérieur
    const modal = document.getElementById('cookieModal');
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          hideModal();
        }
      });
    }
    
    // Permettre ESC pour fermer la modal
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        hideModal();
      }
    });
  }
  
  // Lancer l'initialisation au chargement de la page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Exposer certaines fonctions globalement si nécessaire
  window.cookieConsent = {
    show: showBanner,
    hide: hideBanner,
    showSettings: showModal,
    hasConsent: hasConsent,
    getPreferences: () => getCookie(COOKIE_CONSENT_NAME)
  };
  
})();
