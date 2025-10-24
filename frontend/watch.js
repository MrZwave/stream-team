// ========================================
// 🎥 WATCH PAGE - Script Principal
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const loadingState = document.getElementById('loadingState');
  const noLiveState = document.getElementById('noLiveState');
  const streamersGrid = document.getElementById('streamersGrid');
  const playerSection = document.getElementById('playerSection');
  const notifBtn = document.getElementById('notifBtn');
  const notifPanel = document.getElementById('notifPanel');
  const closeNotif = document.getElementById('closeNotif');
  const menuBtn = document.getElementById('menuBtn');
  const menuDropdown = document.getElementById('menuDropdown');
  const backToList = document.getElementById('backToList');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const popoutBtn = document.getElementById('popoutBtn');
  const shareBtn = document.getElementById('shareBtn');
  const sortSelect = document.getElementById('sortSelect');
  
  let currentStreams = [];
  let currentLogin = null;

  // ========================================
  // 🔄 Chargement des Streams
  // ========================================
  async function loadLiveStreams() {
    try {
      const res = await fetch('/api/live');
      const data = await res.json();
      const liveData = data.liveData || [];

      if (!liveData || liveData.length === 0) {
        showNoLive();
        return;
      }

      currentStreams = liveData;
      updateStats(liveData);
      displayStreamers(liveData);
      
    } catch (err) {
      console.error('Erreur chargement lives:', err);
      showError();
    }
  }

  // ========================================
  // 📊 Mise à jour des Stats
  // ========================================
  function updateStats(streams) {
    const liveCount = streams.length;
    const totalViewers = streams.reduce((sum, s) => sum + (s.viewer_count || 0), 0);
    
    document.getElementById('liveCount').textContent = liveCount;
    document.getElementById('totalViewers').textContent = formatNumber(totalViewers);
  }

  // ========================================
  // 🎮 Affichage des Streamers
  // ========================================
  function displayStreamers(streams) {
    loadingState.style.display = 'none';
    streamersGrid.style.display = 'grid';
    streamersGrid.innerHTML = '';

    streams.forEach(stream => {
      const card = createStreamCard(stream);
      streamersGrid.appendChild(card);
    });
  }

  // ========================================
  // 🎴 Création d'une Card Streamer
  // ========================================
  function createStreamCard(stream) {
    const card = document.createElement('article');
    card.className = 'stream-card';
    card.innerHTML = `
      <div class="stream-thumbnail">
        <img 
          src="${stream.thumbnail_url.replace('{width}', '440').replace('{height}', '248')}" 
          alt="${stream.title}"
          loading="lazy"
        />
        <div class="live-badge">
          <i class="fas fa-circle"></i> LIVE
        </div>
        <div class="viewer-badge">
          <i class="fas fa-eye"></i> ${formatNumber(stream.viewer_count)}
        </div>
      </div>
      
      <div class="stream-info">
        <div class="stream-header">
          <img 
            src="${getThumbnail(stream.user_login)}" 
            alt="${stream.user_name}"
            class="stream-avatar"
            loading="lazy"
          />
          <div class="stream-meta">
            <h3 class="stream-title">${stream.title}</h3>
            <p class="stream-user">${stream.user_name}</p>
          </div>
        </div>
        
        <div class="stream-footer">
          <span class="game-tag">
            <i class="fas fa-gamepad"></i> ${stream.game_name || 'Just Chatting'}
          </span>
          <span class="uptime">
            <i class="fas fa-clock"></i> ${calculateUptime(stream.started_at)}
          </span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => loadPlayer(stream));
    return card;
  }

  // ========================================
  // 📺 Chargement du Player
  // ========================================
  function loadPlayer(stream) {
    currentLogin = stream.user_login;
    
    // Mettre à jour les infos du header
    document.getElementById('playerAvatar').src = getThumbnail(stream.user_login);
    document.getElementById('playerName').textContent = stream.user_name;
    document.getElementById('playerGame').textContent = stream.game_name || 'Just Chatting';
    document.getElementById('viewerCount').textContent = formatNumber(stream.viewer_count);
    document.getElementById('uptime').textContent = calculateUptime(stream.started_at);

    // Injecter les iframes
    document.getElementById('twitchPlayer').innerHTML = `
      <iframe
        src="https://player.twitch.tv/?channel=${stream.user_login}&parent=stream-team.site&autoplay=true"
        allowfullscreen
        allow="autoplay; fullscreen"
        loading="lazy">
      </iframe>
    `;

    document.getElementById('twitchChat').innerHTML = `
      <iframe
        src="https://www.twitch.tv/embed/${stream.user_login}/chat?parent=stream-team.site&darkpopout"
        loading="lazy">
      </iframe>
    `;

    // Afficher le player, masquer la grille
    streamersGrid.style.display = 'none';
    playerSection.style.display = 'block';
    
    // Scroll smooth vers le player
    playerSection.scrollIntoView({ behavior: 'smooth' });

    // Mettre à jour l'URL sans recharger
    history.pushState(null, '', `/watch?channel=${stream.user_login}`);
  }

  // ========================================
  // 🔙 Retour à la Liste
  // ========================================
  backToList.addEventListener('click', () => {
    playerSection.style.display = 'none';
    streamersGrid.style.display = 'grid';
    currentLogin = null;
    history.pushState(null, '', '/watch');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ========================================
  // 🔍 Filtres et Tri
  // ========================================
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const filter = btn.dataset.filter;
      applyFilter(filter);
    });
  });

  sortSelect.addEventListener('change', (e) => {
    sortStreams(e.target.value);
  });

  function applyFilter(filter) {
    let filtered = [...currentStreams];
    
    if (filter === 'game') {
      // Regrouper par jeu
      filtered.sort((a, b) => (a.game_name || '').localeCompare(b.game_name || ''));
    } else if (filter === 'viewers') {
      // Trier par viewers
      filtered.sort((a, b) => b.viewer_count - a.viewer_count);
    }
    
    displayStreamers(filtered);
  }

  function sortStreams(sortBy) {
    let sorted = [...currentStreams];
    
    if (sortBy === 'viewers') {
      sorted.sort((a, b) => b.viewer_count - a.viewer_count);
    } else if (sortBy === 'recent') {
      sorted.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
    } else if (sortBy === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    }
    
    currentStreams = sorted;
    displayStreamers(sorted);
  }

  // ========================================
  // 📱 Actions du Player
  // ========================================
  fullscreenBtn.addEventListener('click', () => {
    const iframe = document.querySelector('#twitchPlayer iframe');
    if (iframe.requestFullscreen) {
      iframe.requestFullscreen();
    } else if (iframe.webkitRequestFullscreen) {
      iframe.webkitRequestFullscreen();
    }
  });

  popoutBtn.addEventListener('click', () => {
    if (currentLogin) {
      window.open(`https://twitch.tv/${currentLogin}`, '_blank');
    }
  });

  shareBtn.addEventListener('click', () => {
    const url = `${window.location.origin}/watch?channel=${currentLogin}`;
    
    if (navigator.share) {
      navigator.share({
        title: `Regarder ${document.getElementById('playerName').textContent} sur Stream Team`,
        url: url
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        shareBtn.innerHTML = '<i class="fas fa-check"></i> Lien copié !';
        setTimeout(() => {
          shareBtn.innerHTML = '<i class="fas fa-share"></i> Partager';
        }, 2000);
      });
    }
  });

  // ========================================
  // 🔔 Notifications
  // ========================================
  notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notifPanel.classList.toggle('show');
  });

  closeNotif.addEventListener('click', () => {
    notifPanel.classList.remove('show');
  });

  document.addEventListener('click', (e) => {
    if (!notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
      notifPanel.classList.remove('show');
    }
  });

  // ========================================
  // 📱 Menu Mobile
  // ========================================
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!menuDropdown.contains(e.target) && !menuBtn.contains(e.target)) {
      menuDropdown.classList.remove('show');
    }
  });

  // ========================================
  // 🛠️ Utilitaires
  // ========================================
  function formatNumber(num) {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  function calculateUptime(startedAt) {
    const now = new Date();
    const start = new Date(startedAt);
    const diff = now - start;
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  function getThumbnail(login) {
    // Récupérer depuis le cache ou utiliser l'API
    return `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-70x70.png`;
  }

  function showNoLive() {
    loadingState.style.display = 'none';
    noLiveState.style.display = 'flex';
  }

  function showError() {
    loadingState.innerHTML = `
      <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ff4444;"></i>
      <p>Erreur lors du chargement des streams</p>
      <button onclick="location.reload()" class="btn-primary">Réessayer</button>
    `;
  }

  // ========================================
  // 🚀 Initialisation
  // ========================================
  
  // Charger au démarrage
  await loadLiveStreams();

  // Recharger toutes les 30 secondes
  setInterval(async () => {
    if (playerSection.style.display === 'none') {
      await loadLiveStreams();
    }
  }, 30000);

  // Gérer le bouton back du navigateur
  window.addEventListener('popstate', () => {
    if (playerSection.style.display === 'block') {
      backToList.click();
    }
  });

  // Charger un stream depuis l'URL au démarrage
  const urlParams = new URLSearchParams(window.location.search);
  const channelParam = urlParams.get('channel');
  if (channelParam && currentStreams.length > 0) {
    const stream = currentStreams.find(s => s.user_login === channelParam);
    if (stream) {
      loadPlayer(stream);
    }
  }
});
