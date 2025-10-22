\# 📊 Comparaison des branches `main` et `develop`



\## 🎯 Résumé Exécutif



La branche `develop` contient une \*\*nouvelle fonctionnalité majeure\*\* : un \*\*système d'authentification email/mot de passe\*\* complet, en plus de l'authentification Twitch OAuth existante. Ce système permet aux utilisateurs de créer un compte avec email et mot de passe, indépendamment de Twitch.



---



\## 🆕 Nouvelles Fonctionnalités Ajoutées



\### 1. \*\*Système d'Authentification Email/Password\*\*



\#### 📄 Nouveaux fichiers créés :

\- \*\*`login.html`\*\* : Page de connexion avec formulaire email/password

\- \*\*`register.html`\*\* : Page d'inscription avec formulaire de création de compte



\#### 🔧 Modifications Backend (`app.js`)



\*\*Lignes 816-967\*\* : Ajout d'une section complète de gestion d'utilisateurs



```javascript

//---------------------------------------------------------------------------

//Code LukDum



// Inscription

app.post("/api/user/add", async (req, res) => {

&nbsp; // Validation email/password

&nbsp; // Hash du mot de passe avec bcrypt

&nbsp; // Insertion dans table 'user'

&nbsp; // Gestion des erreurs (email déjà utilisé, etc.)

});



// Connexion

app.post("/api/user/login", async (req, res) => {

&nbsp; // Vérification email

&nbsp; // Comparaison du mot de passe avec bcrypt

&nbsp; // Création de session utilisateur

&nbsp; // Mise à jour du timestamp de connexion

});



// Vérifier session

app.get("/api/user/check", (req, res) => {

&nbsp; // Vérifie si l'utilisateur est connecté

&nbsp; // Retourne les infos de session

});

```



\*\*Nouvelles dépendances\*\* :

\- `bcrypt` : Pour le hachage sécurisé des mots de passe



\*\*Messages de console ajoutés\*\* :

```javascript

console.log("Serveur lancé sur le port 3000");

console.log("📍 Routes disponibles:");

console.log("  POST /api/user/login");

console.log("  POST /api/user/add");

console.log("  GET  /api/user/check");

```



---



\#### 🎨 Modifications Frontend (`script.js`)



\*\*Lignes 286-428\*\* : Nouvelles fonctions d'authentification



\*\*Fonction `addUser(user)`\*\* :

\- Envoie les données d'inscription à `/api/user/add`

\- Gestion des erreurs d'inscription

\- Redirection vers la page de login après succès



\*\*Fonction `loginUser(credentials)`\*\* :

\- Envoie email/password à `/api/user/login`

\- Logs détaillés pour debug

\- Gestion des erreurs de connexion



\*\*Gestionnaire du formulaire d'inscription\*\* :

```javascript

if (document.getElementById("registerForm")) {

&nbsp; // Intercepte la soumission du formulaire

&nbsp; // Récupère email et password

&nbsp; // Appelle addUser()

&nbsp; // Affiche message de succès/erreur

&nbsp; // Redirige vers /login.html

}

```



\*\*Gestionnaire du formulaire de connexion\*\* :

```javascript

if (document.getElementById("loginForm")) {

&nbsp; // Intercepte la soumission

&nbsp; // Affiche spinner pendant la connexion

&nbsp; // Appelle loginUser()

&nbsp; // Redirige vers /index.html si succès

}

```



\*\*Vérification de session\*\* :

```javascript

async function checkSession() {

&nbsp; // Vérifie si l'utilisateur est toujours connecté

&nbsp; // Redirige vers /login.html si déconnecté

}

```



---



\## 📁 Structure des Nouveaux Fichiers



\### `login.html`

```

Structure identique au template principal avec :

\- Header avec menu de navigation

\- Section main avec formulaire de connexion

&nbsp; - Champ email

&nbsp; - Champ password (min 8 caractères)

&nbsp; - Case "Se souvenir de moi"

&nbsp; - Bouton "Se connecter"

&nbsp; - Liens "Mot de passe oublié" et "Créer un compte"

\- Footer avec liens légaux

\- Popup de connexion Twitch (fallback)

```



\### `register.html`

```

Structure identique à login.html mais :

\- Titre "Inscription" au lieu de "Connexion"

\- Action du formulaire : POST /register

\- Même structure de champs

\- Redirection vers login après inscription réussie

```



---



\## 🔄 Flux d'Authentification



\### Inscription (Register)

```

1\. Utilisateur remplit le formulaire (email + password)

2\. JavaScript intercepte la soumission (event.preventDefault)

3\. Appel POST /api/user/add avec les données

4\. Backend vérifie :

&nbsp;  - Présence email/password

&nbsp;  - Longueur password >= 8

&nbsp;  - Email pas déjà utilisé

5\. Hash du password avec bcrypt

6\. Insertion en BDD avec rôle \["user"]

7\. Retour success

8\. Redirection vers /login.html

```



\### Connexion (Login)

```

1\. Utilisateur saisit email + password

2\. JavaScript intercepte la soumission

3\. Appel POST /api/user/login

4\. Backend vérifie :

&nbsp;  - Email existe en BDD

&nbsp;  - Password correspond (bcrypt.compare)

5\. Parse les rôles JSON

6\. Crée req.session.user avec :

&nbsp;  - id, email, name, roles, profile\_image

7\. Met à jour updated\_at en BDD

8\. Retour success avec infos user

9\. Redirection vers /index.html

```



\### Vérification Session

```

1\. Au chargement de page sensible

2\. Appel GET /api/user/check

3\. Vérifie req.session.user

4\. Retour loggedIn: true/false

5\. Redirection si non connecté

```



---



\## 🔒 Sécurité Implémentée



\### Côté Backend

\- ✅ \*\*Hachage bcrypt\*\* : Les mots de passe ne sont jamais stockés en clair

\- ✅ \*\*Validation des données\*\* : Email et password requis

\- ✅ \*\*Longueur minimale\*\* : Password >= 8 caractères

\- ✅ \*\*Unicité email\*\* : Empêche les doublons

\- ✅ \*\*Sessions sécurisées\*\* : MySQL session store

\- ✅ \*\*Gestion d'erreurs\*\* : Messages appropriés sans exposer de détails



\### Côté Frontend

\- ✅ \*\*Validation HTML5\*\* : required, type="email", minlength="8"

\- ✅ \*\*Trim des emails\*\* : Supprime les espaces

\- ✅ \*\*Feedback utilisateur\*\* : Spinner pendant l'envoi

\- ✅ \*\*Gestion d'erreurs\*\* : Alertes appropriées



---



\## 🗄️ Base de Données



\### Nouvelle table requise : `user`

```sql

CREATE TABLE user (

&nbsp; id INT PRIMARY KEY AUTO\_INCREMENT,

&nbsp; email VARCHAR(255) UNIQUE NOT NULL,

&nbsp; password VARCHAR(255) NOT NULL,

&nbsp; roles JSON,

&nbsp; name VARCHAR(255),

&nbsp; image\_name VARCHAR(255),

&nbsp; created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,

&nbsp; updated\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP ON UPDATE CURRENT\_TIMESTAMP

);

```



---



\## 🔄 Compatibilité avec l'Existant



\### ⚠️ Points d'Attention



1\. \*\*Deux systèmes d'auth coexistent\*\* :

&nbsp;  - OAuth Twitch (existant)

&nbsp;  - Email/Password (nouveau)



2\. \*\*Structures de session différentes\*\* :

&nbsp;  - Twitch : `req.session.user` contient `twitch\_id`, `login`, `display\_name`, etc.

&nbsp;  - Email : `req.session.user` contient `id`, `email`, `name`, `roles`



3\. \*\*Tables différentes\*\* :

&nbsp;  - Twitch : table `streamers`

&nbsp;  - Email : table `user`



\### 🚨 Risques Potentiels



\- \*\*Confusion de session\*\* : Les deux types d'auth utilisent `req.session.user` mais avec des structures différentes

\- \*\*Redirection multiple\*\* : Certaines pages redirigent vers `/login.html`, d'autres vers l'auth Twitch

\- \*\*Gestion des rôles\*\* : Les utilisateurs Twitch ont un champ `is\_admin`, les utilisateurs email ont un array `roles`



---



\## 📊 Statistiques des Modifications



| Fichier | Lignes Ajoutées | Type de Modification |

|---------|----------------|---------------------|

| `app.js` | ~150 lignes | Nouvelles routes API |

| `script.js` | ~140 lignes | Fonctions auth + handlers |

| `login.html` | ~161 lignes | Nouveau fichier |

| `register.html` | ~161 lignes | Nouveau fichier |



\*\*Total : ~612 lignes de code ajoutées\*\*



---



\## ✅ Tests Recommandés Avant Merge



1\. \*\*Test d'inscription\*\* :

&nbsp;  - Email valide/invalide

&nbsp;  - Password < 8 caractères

&nbsp;  - Email déjà utilisé

&nbsp;  - Inscription réussie



2\. \*\*Test de connexion\*\* :

&nbsp;  - Credentials valides

&nbsp;  - Email inexistant

&nbsp;  - Mauvais password

&nbsp;  - Session créée correctement



3\. \*\*Test de session\*\* :

&nbsp;  - Vérification après login

&nbsp;  - Persistance de session

&nbsp;  - Déconnexion



4\. \*\*Test de compatibilité\*\* :

&nbsp;  - Auth Twitch toujours fonctionnelle

&nbsp;  - Pas de conflit entre les deux systèmes

&nbsp;  - Redirections appropriées



5\. \*\*Test de sécurité\*\* :

&nbsp;  - SQL injection

&nbsp;  - XSS

&nbsp;  - CSRF

&nbsp;  - Brute force login



---



\## 📝 Recommandations



\### Avant le Merge



1\. \*\*Unifier les structures de session\*\* :

&nbsp;  ```javascript

&nbsp;  // Proposer une structure commune :

&nbsp;  req.session.user = {

&nbsp;    id: ...,

&nbsp;    type: 'twitch' | 'email',

&nbsp;    // Puis données spécifiques

&nbsp;  }

&nbsp;  ```



2\. \*\*Créer un middleware d'auth unifié\*\* :

&nbsp;  ```javascript

&nbsp;  function requireAuth(req, res, next) {

&nbsp;    if (!req.session.user) {

&nbsp;      return res.redirect('/login-choice.html');

&nbsp;    }

&nbsp;    next();

&nbsp;  }

&nbsp;  ```



3\. \*\*Ajouter des tests unitaires\*\* :

&nbsp;  - Pour les nouvelles routes

&nbsp;  - Pour les fonctions de hachage

&nbsp;  - Pour la gestion de session



4\. \*\*Documenter\*\* :

&nbsp;  - Schéma de la table `user`

&nbsp;  - Architecture d'authentification

&nbsp;  - Procédure de migration



5\. \*\*Page de choix d'authentification\*\* :

&nbsp;  - Créer `/login-choice.html`

&nbsp;  - Permettre à l'utilisateur de choisir entre Twitch et Email



\### Après le Merge



1\. \*\*Monitoring\*\* :

&nbsp;  - Logger les tentatives de connexion

&nbsp;  - Tracker les erreurs d'auth

&nbsp;  - Mesurer l'adoption du nouveau système



2\. \*\*Migration des utilisateurs\*\* :

&nbsp;  - Permettre aux utilisateurs Twitch d'ajouter un email/password

&nbsp;  - Lier les comptes existants



3\. \*\*Amélirations\*\* :

&nbsp;  - Reset password

&nbsp;  - Confirmation par email

&nbsp;  - 2FA optionnel



---



\## 🎯 Conclusion



La branche `develop` introduit un \*\*système d'authentification complet et fonctionnel\*\* par email/password. Le code est bien structuré et sécurisé avec bcrypt, mais nécessite quelques ajustements pour s'intégrer harmonieusement avec le système OAuth Twitch existant.



\*\*Statut : Prêt pour review avec modifications mineures recommandées\*\* ✅



---



\*Document généré le 22 octobre 2025\*

\*Analysé pour Stream Team HQ\*

