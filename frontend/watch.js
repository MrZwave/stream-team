document.addEventListener('DOMContentLoaded', async () => {
    const liveStreamers = document.getElementById('liveStreamers');
    const playerContainer = document.getElementById('playerContainer');
    const twitchPlayer = document.getElementById('twitchPlayer');
    const twitchChat = document.getElementById('twitchChat');
  
    try {
      const res = await fetch('/api/live');
      const data = await res.json();
      const liveUsers = data.liveData || [];
  
      if (!liveUsers.length) {
        liveStreamers.innerHTML = '<p>Aucun membre n\'est en live actuellement. 🚫</p>';
        return;
      }
  
      liveStreamers.innerHTML = '<h2>🎥 Streamers en direct :</h2>';
  
      liveUsers.forEach(streamer => {
        const button = document.createElement('button');
        button.textContent = `▶️ ${streamer.user_name}`;
        button.className = 'watch-button';
        button.onclick = () => {
          loadStreamer(streamer.user_login);
        };
        liveStreamers.appendChild(button);
      });
  
    } catch (err) {
      console.error('Erreur chargement lives:', err);
      liveStreamers.innerHTML = '<p>Erreur lors du chargement des streamers en direct.</p>';
    }
  
function loadStreamer(login) {
  // 1. Ajoute une classe d’activation (utile si tu veux contrôler le style CSS proprement)
  playerContainer.classList.add('visible');

  // 2. Injecte les iframes sans forcer le scroll
  twitchPlayer.innerHTML = `
    <iframe
      class="responsive-frame"
      src="https://player.twitch.tv/?channel=${login}&parent=stream-team.site"
      allowfullscreen
      loading="lazy">
    </iframe>
  `;
  twitchChat.innerHTML = `
    <iframe
      class="responsive-frame"
      src="https://www.twitch.tv/embed/${login}/chat?parent=stream-team.site"
      loading="lazy">
    </iframe>
  `;

  // 3. Utilise requestAnimationFrame pour éviter un reflow synchrone
  requestAnimationFrame(() => {
    playerContainer.scrollIntoView({ behavior: 'smooth' });
  });
}

  });
  