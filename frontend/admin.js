document.addEventListener('DOMContentLoaded', async () => {
  const totalMembers = document.getElementById('totalMembers');
  const totalCards = document.getElementById('totalCards');
  const streamersList = document.getElementById('streamersList');
  const addCardForm = document.getElementById('addCardForm');
  const adminMessage = document.getElementById('adminMessage');

  try {
    const [streamersRes, cardsRes] = await Promise.all([
      fetch('/api/admin/streamers', {
        credentials: 'include' // ✅ essentiel pour que la session soit envoyée
      }),
      fetch('/api/admin/cards')
    ]);

    if (!streamersRes.ok || !cardsRes.ok) throw new Error('Accès refusé');

    const streamers = await streamersRes.json();
    const cards = await cardsRes.json();

    totalMembers.textContent = streamers.length;
    totalCards.textContent = cards.length;

    for (const streamer of streamers) {
      const userCardsRes = await fetch(`/api/admin/user-cards/${streamer.id}`);
      const userCards = await userCardsRes.json();

      const streamerDiv = document.createElement('div');
      streamerDiv.className = 'streamer-block';
      streamerDiv.innerHTML = `
        <h3>${streamer.display_name} (${streamer.login})</h3>
        <p>📅 Inscrit le: ${new Date(streamer.created_at_site).toLocaleDateString()}</p>
        <p>🃏 Cartes : ${userCards.length}</p>
        <ul>${userCards.map(c => `<li>${c.name} (${c.rarity})</li>`).join('')}</ul>
      `;
      streamersList.appendChild(streamerDiv);
    }

    renderCardList(cards);

  } catch (err) {
    streamersList.innerHTML = '<p>Erreur de chargement ou accès refusé.</p>';
    console.error('Erreur admin:', err);
  }

  addCardForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cardName').value.trim();
    const rarity = document.getElementById('cardRarity').value.trim();
    const image_url = document.getElementById('cardImage').value.trim();
    const description = document.getElementById('cardDescription').value.trim();

    try {
      const res = await fetch('/api/admin/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, rarity, image_url, description })
      });

      const data = await res.json();
      if (res.ok) {
        showPopupMessage('✅ Carte ajoutée.');
        addCardForm.reset();
        location.reload();
      } else {
        showPopupMessage(data.error || '❌ Erreur.', false);
      }
    } catch (err) {
      console.error('Erreur ajout carte:', err);
      showPopupMessage('❌ Erreur technique.', false);
    }
  });

  function renderCardList(cards) {
    const container = document.createElement('div');
    container.style.marginTop = '30px';
    container.innerHTML = '<h2>Cartes existantes</h2>';

    cards.forEach(card => {
      const div = document.createElement('div');
      div.innerHTML = `
        <strong>${card.name}</strong> (${card.rarity})
        <button style="margin-left:10px;" onclick="deleteCard(${card.id})">🗑️ Supprimer</button>
      `;
      container.appendChild(div);
    });

    streamersList.parentElement.appendChild(container);
  }

  window.deleteCard = async function (cardId) {
    if (!confirm('Supprimer cette carte ?')) return;
    try {
      const res = await fetch(`/api/admin/cards/${cardId}`, { method: 'DELETE' });
      if (res.ok) {
        showPopupMessage('✅ Carte supprimée.');
        setTimeout(() => location.reload(), 1500);
      } else {
        showPopupMessage('❌ Erreur suppression.', false);
      }
    } catch (err) {
      console.error('Erreur suppression:', err);
      showPopupMessage('❌ Erreur technique.', false);
    }
  };

  function showPopupMessage(msg, success = true) {
    const popup = document.createElement('div');
    popup.className = `admin-popup ${success ? 'success' : 'error'}`;
    popup.textContent = msg;
    document.body.appendChild(popup);
    setTimeout(() => popup.classList.add('visible'), 100);
    setTimeout(() => {
      popup.classList.remove('visible');
      popup.remove();
    }, 2500);
  }
});

// Gestion de l'ajout de quête
const questForm = document.getElementById('questForm');

if (questForm) {
  questForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('questName').value.trim();
    const description = document.getElementById('questDescription').value.trim();
    const type = document.getElementById('questType').value;
    const xp_reward = document.getElementById('questXP').value.trim();
    const requirement = document.getElementById('questRequirement').value.trim();
    const card_reward = document.getElementById('questCardReward').value.trim();

    // Validation simple des champs
    if (!name || !description || !xp_reward || !requirement) {
      alert('Veuillez remplir tous les champs obligatoires.');
      return;
    }

    try {
      const res = await fetch('/api/admin/quests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          type,
          xp_reward,
          requirement,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        alert('✅ Quête ajoutée avec succès !');
        questForm.reset();
        chargerQuetes(); // Recharge la liste des quêtes
      } else {
        alert(data.error || '❌ Erreur lors de l\'ajout de la quête.');
      }
    } catch (err) {
      console.error('Erreur ajout quête:', err);
      alert('❌ Erreur technique, veuillez réessayer plus tard.');
    }
  });
}



const notifForm = document.getElementById('notifForm');

notifForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.getElementById('notifType').value;
  const message = document.getElementById('notifMessage').value.trim();

  if (!type || !message) return showPopupMessage('❌ Tous les champs sont requis.', false);

  try {
    const res = await fetch('/api/admin/push-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message })
    });

    const data = await res.json();
    if (res.ok) {
      showPopupMessage('✅ Notification envoyée.');
      notifForm.reset();
    } else {
      showPopupMessage(data.error || '❌ Erreur.', false);
    }
  } catch (err) {
    console.error('Erreur notif:', err);
    showPopupMessage('❌ Erreur technique.', false);
  }
});

function showPopupMessage(msg, success = true) {
  const popup = document.createElement('div');
  popup.className = `admin-popup ${success ? 'success' : 'error'}`;
  popup.textContent = msg;
  document.body.appendChild(popup);
  setTimeout(() => popup.classList.add('visible'), 100);
  setTimeout(() => {
    popup.classList.remove('visible');
    popup.remove();
  }, 2500);
}


async function chargerQuetes() {
  console.log("↪ Chargement des quêtes...");
  try {
    const response = await fetch('/api/admin/quests');
    const data = await response.json();

    if (!data.success || !data.quests) return;

    const tbody = document.getElementById('questTableBody');
    tbody.innerHTML = '';

    data.quests.forEach(quest => {
      const row = document.createElement('tr');

      row.innerHTML = `
        <td>${quest.name}</td>
        <td>${quest.description}</td>
        <td>${quest.type}</td>
        <td>${quest.xp_reward}</td>
        <td><code title='${quest.requirement}'>${quest.requirement}</code></td>
        <td>${quest.card_reward_id ? `ID ${quest.card_reward_id}` : '—'}</td>
        <td><button onclick="supprimerQuete(${quest.id})" style="color:red;">🗑</button></td>
      `;

      tbody.appendChild(row);
    });
  } catch (err) {
    console.error('Erreur lors du chargement des quêtes :', err);
  }
}

async function supprimerQuete(id) {
  if (!confirm('Tu veux vraiment supprimer cette quête ?')) return;
  try {
    const res = await fetch('/api/admin/quests/' + id, {
      method: 'DELETE'
    });
    const result = await res.json();
    if (result.success) {
      alert('Quête supprimée avec succès');
      chargerQuetes();
    } else {
      alert('Erreur lors de la suppression');
    }
  } catch (e) {
    console.error(e);
    alert('Erreur réseau.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // ... autres initialisations
  chargerQuetes(); // 👈 Ajoute cet appel ici pour que les quêtes s'affichent dès le chargement
});
