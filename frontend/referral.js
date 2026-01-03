// Copier le code
document.getElementById('copyButton').addEventListener('click', () => {
  const input = document.getElementById('referralInput');
  input.select();
  navigator.clipboard.writeText(input.value)
    .then(() => alert('Code copié : ' + input.value))
    .catch(() => alert('Impossible de copier le code'));
});

// Charger les données réelles
async function loadReferralData() {
  try {
    const res = await fetch('/api/referrals', { credentials: 'include' });
    if (!res.ok) throw new Error('Erreur API');
    const data = await res.json();

    // Code de parrainage
    const input = document.getElementById('referralInput');
    input.value = data.referralCode;

    // Stats
    document.getElementById('totalReferrals').textContent = data.totalReferrals;
    document.getElementById('activeReferrals').textContent = data.activeReferrals;
    document.getElementById('xpEarned').textContent = data.xpEarned;
    document.getElementById('coinsEarned').textContent = data.coinsEarned;

    // Liste des filleuls
    const list = document.getElementById('referralList');
    list.innerHTML = '';
    if (data.friends.length === 0) {
      list.innerHTML = '<li>Aucun filleul pour le moment</li>';
    } else {
      data.friends.forEach(f => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${f.username}</span>
                        <span class="${f.active ? 'status-active' : 'status-inactive'}">
                          ${f.active ? 'Actif' : 'Inactif'}
                        </span>`;
        list.appendChild(li);
      });
    }

  } catch (err) {
    console.error(err);
    document.getElementById('referralList').innerHTML = '<li>Impossible de charger les filleuls</li>';
  }
}

loadReferralData();
