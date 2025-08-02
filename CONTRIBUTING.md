# 🤝 Guide de contribution – Stream Team

Merci de vouloir contribuer à Stream Team ! Voici quelques règles simples pour assurer une collaboration efficace.

## 🛠 Prérequis

- Node.js ≥ 18
- MariaDB/MySQL pour les données
- Un accès à un compte développeur Twitch (pour l’API)
- Fork et clone du projet :

```bash
git clone https://github.com/<ton-user>/stream-team.git
cd stream-team
npm install
🚧 Branches
main : Branche stable (production)

dev : Branche de développement (pull requests ici)

Crée une branche pour chaque fonctionnalité ou correction :

bash
Copier
Modifier
git checkout -b feat/ajout-de-cartes
✅ Bonnes pratiques
Nomme tes commits clairement (exemples plus bas)

Teste localement avant de proposer une PR

Respecte le style de code en place

Ne pousse jamais .env, mots de passe ou credentials

🧪 Tests (à venir)
Des tests unitaires et de sécurité seront ajoutés prochainement. Toute contribution dans ce sens est bienvenue !

📝 Convention de commits
Utilise la convention suivante dans tes commits :

bash
Copier
Modifier
type: message clair
Types valides :

feat: nouvelle fonctionnalité

fix: correction de bug

docs: documentation

style: mise en forme (indentation, format)

refactor: refacto sans changement de comportement

test: ajout ou modification de tests

chore: tâches diverses (build, config, etc.)

🙌 Merci !
Tu peux poser des questions en créant une issue ou en rejoignant le Discord (bientôt disponible).
