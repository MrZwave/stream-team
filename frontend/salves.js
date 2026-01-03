// ========================================
// 🔥 SYSTÈME DE SALVES - FRONTEND COMPLET
// À ajouter dans streamer.html (ou créer salves.js)
// ========================================

/**
 * Classe SalveButton pour gérer le bouton et les animations
 */
class SalveButton {
  constructor(targetLogin, targetName, containerSelector) {
    this.targetLogin = targetLogin;
    this.targetName = targetName;
    this.container = document.querySelector(containerSelector);
    this.cooldownActive = false;
    this.cooldownTimer = null;
    
    this.init();
  }

  async init() {
    // Vérifier l'état du cooldown
    await this.checkCooldown();
    
    // Créer le bouton
    this.createButton();
    
    // Mettre à jour régulièrement
    setInterval(() => this.checkCooldown(), 5000);
  }

  async checkCooldown() {
    try {
      const response = await fetch('/api/salve/cooldown');
      const data = await response.json();
      
      if (data.success) {
        this.cooldownActive = !data.data.canSend;
        this.remainingSeconds = data.data.remainingSeconds || 0;
        this.dailyUsed = data.data.dailyUsed;
        this.dailyLimit = data.data.dailyLimit;
        
        this.updateButton();
      }
    } catch (error) {
      console.error('Erreur cooldown:', error);
    }
  }

  createButton() {
    const button = document.createElement('button');
    button.className = 'salve-button';
    button.id = 'salve-btn';
    button.innerHTML = `
      <span class="salve-icon">🔥</span>
      <span class="salve-text">Envoyer une salve</span>
      <span class="salve-count">${this.dailyUsed || 0}/${this.dailyLimit || 20}</span>
    `;
    
    button.addEventListener('click', () => this.sendSalve());
    
    this.container.appendChild(button);
    this.button = button;
  }

  updateButton() {
    if (!this.button) return;
    
    const text = this.button.querySelector('.salve-text');
    const count = this.button.querySelector('.salve-count');
    
    if (this.cooldownActive) {
      this.button.classList.add('cooldown');
      this.button.disabled = true;
      text.textContent = `Cooldown: ${this.remainingSeconds}s`;
      
      // Décompte
      if (this.cooldownTimer) clearInterval(this.cooldownTimer);
      this.cooldownTimer = setInterval(() => {
        this.remainingSeconds--;
        if (this.remainingSeconds <= 0) {
          clearInterval(this.cooldownTimer);
          this.cooldownActive = false;
          this.updateButton();
        } else {
          text.textContent = `Cooldown: ${this.remainingSeconds}s`;
        }
      }, 1000);
    } else {
      this.button.classList.remove('cooldown');
      this.button.disabled = false;
      text.textContent = 'Envoyer une salve';
    }
    
    count.textContent = `${this.dailyUsed || 0}/${this.dailyLimit || 20}`;
  }

  async sendSalve() {
    if (this.cooldownActive) return;
    
    // Animation de clic
    this.button.classList.add('sending');
    
    try {
      const response = await fetch('/api/salve/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLogin: this.targetLogin })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Succès !
        this.showSuccessAnimation();
        this.showNotification(`Salve envoyée à ${this.targetName} ! 🔥`, 'success');
        
        // Mettre à jour les infos
        this.dailyUsed = data.data.limits.dailyUsed;
        this.cooldownActive = true;
        this.remainingSeconds = data.data.limits.cooldownSeconds;
        this.updateButton();
        
        // Mettre à jour le compteur de salves sur la page
        this.updateSalveCounter(data.data.target.totalSalves);
        
        // Si level up
        if (data.data.sender.leveledUp) {
          this.showNotification(
            `🎉 Level Up ! Tu es maintenant niveau ${data.data.sender.newLevel}`, 
            'levelup'
          );
        }
        
      } else {
        // Erreur
        this.showNotification(data.message || data.error, 'error');
      }
      
    } catch (error) {
      console.error('Erreur envoi salve:', error);
      this.showNotification('Erreur lors de l\'envoi de la salve', 'error');
    } finally {
      this.button.classList.remove('sending');
    }
  }

  showSuccessAnimation() {
    // Créer des particules de feu
    for (let i = 0; i < 10; i++) {
      this.createFireParticle();
    }
    
    // Animation du bouton
    this.button.classList.add('success-flash');
    setTimeout(() => {
      this.button.classList.remove('success-flash');
    }, 500);
  }

  createFireParticle() {
    const particle = document.createElement('div');
    particle.className = 'fire-particle';
    particle.textContent = '🔥';
    
    // Position aléatoire autour du bouton
    const rect = this.button.getBoundingClientRect();
    particle.style.left = rect.left + rect.width / 2 + (Math.random() - 0.5) * 100 + 'px';
    particle.style.top = rect.top + rect.height / 2 + 'px';
    
    document.body.appendChild(particle);
    
    // Animation
    setTimeout(() => particle.classList.add('animate'), 10);
    
    // Supprimer après l'animation
    setTimeout(() => particle.remove(), 1000);
  }

  updateSalveCounter(newCount) {
    // Mettre à jour le compteur de salves dans la page
    const counter = document.querySelector('#salves-count, .salves-total');
    if (counter) {
      counter.textContent = newCount;
      counter.classList.add('pulse');
      setTimeout(() => counter.classList.remove('pulse'), 500);
    }
  }

  showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.className = `salve-notification ${type}`;
    notif.textContent = message;
    
    document.body.appendChild(notif);
    
    setTimeout(() => notif.classList.add('show'), 10);
    setTimeout(() => {
      notif.classList.remove('show');
      setTimeout(() => notif.remove(), 300);
    }, 3000);
  }
}

// ========================================
// INITIALISATION
// ========================================

// Attendre que la page soit chargée
document.addEventListener('DOMContentLoaded', function() {
  // Attendre que les infos du streamer soient chargées
  const observer = new MutationObserver(() => {
    const username = document.getElementById('profile-username');
    const displayName = document.getElementById('profile-name');
    
    if (username && displayName && username.textContent.startsWith('@')) {
      const login = username.textContent.replace('@', '');
      const name = displayName.textContent;
      
      // Vérifier qu'on ne crée pas plusieurs boutons
      if (!document.getElementById('salve-btn')) {
        // Créer le bouton dans la section actions
        const actionsContainer = document.querySelector('.profile-actions, .streamer-actions');
        if (actionsContainer) {
          new SalveButton(login, name, '.profile-actions, .streamer-actions');
        }
      }
      
      observer.disconnect();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
});

console.log('🔥 Système de salves chargé');
