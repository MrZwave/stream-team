# ⚡ Stream Team

> Plateforme web interactive pour les streamers, conçue pour mettre en valeur leurs lives, statistiques, clips et missions de progression.  
> Projet communautaire propulsé par Node.js, Express, EJS, MariaDB, OAuth Twitch et une interface full responsive en HTML/CSS/JS.

---

## 🌐 Objectif du projet

Créer un **hub centralisé** où chaque membre de l'équipe Stream Team peut :
- Afficher ses infos Twitch dynamiquement.
- Suivre ses statistiques (clics, lives, viewers, quêtes, cartes, etc).
- Participer à des missions journalières et hebdo pour gagner des récompenses.
- Mettre en valeur ses meilleurs clips Twitch.
- Être repéré par les autres créateurs et partenaires.

---

## 📁 Structure du projet

```bash
stream-team/
├── app.js                 # Backend principal (Express)
├── .env                  # Variables d’environnement (Twitch, DB, etc.)
├── frontend/             # Tous les fichiers frontend (HTML, CSS, JS, images)
│   ├── style.css
│   ├── index.html
│   ├── script.js
│   └── ...
├── views/                # Templates EJS dynamiques (streamer.ejs, etc.)
├── routes/               # (si utilisé) Routes Express séparées
├── database/             # (si utilisé) Scripts SQL, fichiers init
├── .gitignore
└── README.md
⚙️ Prérequis
Node.js 18+

MariaDB / MySQL

Compte développeur Twitch

PM2 (en prod)

🧪 Installation (dev)
Cloner le dépôt :

bash
Copier
Modifier
git clone https://github.com/<ton-pseudo>/stream-team.git
cd stream-team
Installer les dépendances :

bash
Copier
Modifier
npm install
Créer un fichier .env :

dotenv
Copier
Modifier
TWITCH_CLIENT_ID=xxxxxxxx
TWITCH_CLIENT_SECRET=xxxxxxxx
TWITCH_REDIRECT_URI=http://localhost:3000/auth/twitch/callback
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=streamteam
SESSION_SECRET=devsecret
Démarrer le serveur :

bash
Copier
Modifier
node app.js
🚀 Lancer en production
Utilise PM2 :

bash
Copier
Modifier
pm2 start app.js --name streamteam-v2
pm2 save
pm2 startup
🧠 Pour les contributeurs
Merci de respecter les règles suivantes :

Toujours travailler sur une branche dédiée :

bash
Copier
Modifier
git checkout -b feat/ma-fonction
Suivre la convention de nommage pour les commits :

makefile
Copier
Modifier
feat: ajout de fonctionnalité
fix: correction d’un bug
style: modifications visuelles
refactor: amélioration de code sans changement de comportement
Toujours tester en local avant push.

Ne pas modifier app.js en prod sans validation.

✨ Fonctionnalités clés
Authentification Twitch via OAuth

Affichage des streamers en live

Dashboard personnel avec statistiques Twitch réelles

Cartes à collectionner

Notifications dynamiques (mises à jour, récompenses, missions)

Missions & quêtes quotidiennes/hebdomadaires

Système de salves, clics, XP

Intégration clips Twitch

Mode admin pour ajouter des cartes / modifier les profils

🔐 Sécurité
Les routes sensibles (admin, dashboard) sont protégées par session.

Les tokens Twitch sont stockés temporairement.

Les variables sensibles sont chargées depuis .env.

🧩 Contribution
Envie d’ajouter une fonctionnalité ? Rejoins le Discord de la team ou fais une PR :

Fork le repo

Crée une branche : git checkout -b feat/nouvelle-feature

Code ➕ Test ➕ Commit

Push et fais une pull request

👥 Crédits
Projet imaginé par la communauté Cornet E-sport

Développé par l'équipe tech Stream Team

Technologies : Twitch API, Node.js, Express, MariaDB, EJS, CSS3, HTML5

🛰️ Lien de production (si déployé)
🌍 https://stream-team.site/

📫 Contact
Pour toute question, bug ou idée :

✉️ contact@cornetdev.com

💬 Discord Stream Team
