\# 🎯 Recommandations Stratégiques - Système d'Authentification Stream Team



\## 📊 Analyse du Contexte



\### Objectifs Principaux du Site

1\. \*\*Streamers\*\* : Mettre en avant leurs streams et profils

2\. \*\*Viewers\*\* : Découvrir des streamers francophones

3\. \*\*Engagement\*\* : Watching embed Twitch dans le site

4\. \*\*Gamification\*\* : Tasks/récompenses basées sur actions Twitch-centric

5\. \*\*Communauté\*\* : Interaction autour de l'écosystème Twitch



\### Public Cible

\- 🎮 \*\*100% utilisateurs Twitch\*\* (streamers + viewers)

\- 🇫🇷 Communauté francophone

\- 👥 Engagement social autour des streams

\- 🏆 Recherche de gamification et récompenses



---



\## ⚠️ PROBLÈME MAJEUR IDENTIFIÉ



\### Le système Email/Password de la branche `develop` est \*\*CONTRE-PRODUCTIF\*\* ❌



\*\*Pourquoi ?\*\*



1\. \*\*Friction inutile\*\* : Demander une inscription email alors que 100% de tes utilisateurs ont déjà un compte Twitch

2\. \*\*Duplication d'efforts\*\* : Maintenir 2 systèmes d'auth différents

3\. \*\*Expérience fragmentée\*\* : Certains users via Twitch, d'autres via email = confusion

4\. \*\*Impossibilité de tracking Twitch\*\* : Les tasks nécessitent l'identité Twitch de l'utilisateur

5\. \*\*Complexité technique\*\* : 2 tables, 2 structures de session, 2 flux d'auth à maintenir

6\. \*\*Perte de fonctionnalités\*\* : Un user email/password ne peut pas:

&nbsp;  - Avoir son vrai profil Twitch sync

&nbsp;  - Valider des tasks Twitch (regarder stream, commenter chat, etc.)

&nbsp;  - Être identifié comme streamer officiel

&nbsp;  - Recevoir des stats réelles de son channel



---



\## ✅ RECOMMANDATION PRINCIPALE



\### \*\*NE PAS MERGER la branche develop dans main\*\*



\### \*\*Utiliser UNIQUEMENT l'OAuth Twitch\*\*



---



\## 🎯 Architecture Recommandée



\### 1. OAuth Twitch comme UNIQUE méthode d'authentification



```javascript

// Flux simplifié et optimisé

app.get('/auth/twitch', (req, res) => {

&nbsp; // Scopes optimisés pour tes besoins

&nbsp; const scopes = \[

&nbsp;   'user:read:email',           // Email pour contact

&nbsp;   'user:read:follows',         // Suivis pour recommendations

&nbsp;   'channel:read:subscriptions', // Vérif abonnements (tasks)

&nbsp;   'chat:read',                 // Validation task "commenter"

&nbsp;   'moderator:read:followers'   // Stats followers

&nbsp; ];

&nbsp; 

&nbsp; res.redirect(`https://id.twitch.tv/oauth2/authorize?...\&scope=${scopes.join(' ')}`);

});

```



\### 2. Table unique `users` avec intégration Twitch



```sql

CREATE TABLE users (

&nbsp; id INT PRIMARY KEY AUTO\_INCREMENT,

&nbsp; 

&nbsp; -- Données Twitch (source of truth)

&nbsp; twitch\_id VARCHAR(255) UNIQUE NOT NULL,

&nbsp; login VARCHAR(255) UNIQUE NOT NULL,

&nbsp; display\_name VARCHAR(255),

&nbsp; email VARCHAR(255),

&nbsp; profile\_image\_url TEXT,

&nbsp; broadcaster\_type ENUM('', 'affiliate', 'partner'),

&nbsp; 

&nbsp; -- Données locales

&nbsp; role ENUM('viewer', 'streamer', 'admin') DEFAULT 'viewer',

&nbsp; points INT DEFAULT 0,

&nbsp; level INT DEFAULT 1,

&nbsp; bio TEXT,

&nbsp; 

&nbsp; -- Préférences

&nbsp; notifications\_enabled BOOLEAN DEFAULT TRUE,

&nbsp; theme ENUM('dark', 'light') DEFAULT 'dark',

&nbsp; 

&nbsp; -- Timestamps

&nbsp; created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,

&nbsp; updated\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP ON UPDATE CURRENT\_TIMESTAMP,

&nbsp; last\_seen TIMESTAMP DEFAULT CURRENT\_TIMESTAMP,

&nbsp; 

&nbsp; -- Indexes

&nbsp; INDEX idx\_twitch\_id (twitch\_id),

&nbsp; INDEX idx\_login (login)

);

```



\### 3. Système de rôles intelligent



```javascript

// Auto-détection du type d'utilisateur

async function determineUserRole(twitchData) {

&nbsp; const { broadcaster\_type, login } = twitchData;

&nbsp; 

&nbsp; // Vérifie si c'est un streamer actif

&nbsp; if (broadcaster\_type === 'partner' || broadcaster\_type === 'affiliate') {

&nbsp;   return 'streamer';

&nbsp; }

&nbsp; 

&nbsp; // Vérifie s'il a déjà streamé (API Twitch)

&nbsp; const streams = await getRecentStreams(login);

&nbsp; if (streams.length > 0) {

&nbsp;   return 'streamer';

&nbsp; }

&nbsp; 

&nbsp; return 'viewer';

}

```



---



\## 🏗️ Fonctionnalités à Implémenter



\### 1. \*\*Onboarding Intelligent\*\*



```javascript

// Première connexion

app.get('/auth/twitch/callback', async (req, res) => {

&nbsp; // ... OAuth flow ...

&nbsp; 

&nbsp; const \[\[existingUser]] = await db.query(

&nbsp;   'SELECT \* FROM users WHERE twitch\_id = ?',

&nbsp;   \[twitchData.id]

&nbsp; );

&nbsp; 

&nbsp; if (!existingUser) {

&nbsp;   // Nouveau user → onboarding

&nbsp;   const role = await determineUserRole(twitchData);

&nbsp;   

&nbsp;   await db.execute(`

&nbsp;     INSERT INTO users (

&nbsp;       twitch\_id, login, display\_name, email, 

&nbsp;       profile\_image\_url, broadcaster\_type, role

&nbsp;     ) VALUES (?, ?, ?, ?, ?, ?, ?)

&nbsp;   `, \[

&nbsp;     twitchData.id,

&nbsp;     twitchData.login,

&nbsp;     twitchData.display\_name,

&nbsp;     twitchData.email,

&nbsp;     twitchData.profile\_image\_url,

&nbsp;     twitchData.broadcaster\_type,

&nbsp;     role

&nbsp;   ]);

&nbsp;   

&nbsp;   // Redirection vers onboarding selon le rôle

&nbsp;   if (role === 'streamer') {

&nbsp;     return res.redirect('/onboarding/streamer');

&nbsp;   } else {

&nbsp;     return res.redirect('/onboarding/viewer');

&nbsp;   }

&nbsp; }

&nbsp; 

&nbsp; // User existant → sync des données Twitch

&nbsp; await syncTwitchData(existingUser.id, twitchData);

&nbsp; res.redirect('/');

});

```



\### 2. \*\*Dashboard Contextualisé\*\*



```javascript

// Dashboard adapté au rôle

app.get('/dashboard', requireAuth, async (req, res) => {

&nbsp; const user = req.session.user;

&nbsp; 

&nbsp; if (user.role === 'streamer') {

&nbsp;   // Stats streameur

&nbsp;   const stats = await getStreamerStats(user.twitch\_id);

&nbsp;   const viewers = await getViewersList(user.twitch\_id);

&nbsp;   const earnings = await calculatePoints(user.id);

&nbsp;   

&nbsp;   return res.render('dashboard-streamer', { user, stats, viewers, earnings });

&nbsp; } else {

&nbsp;   // Stats viewer

&nbsp;   const watchedStreams = await getWatchHistory(user.id);

&nbsp;   const favoriteStreamers = await getFavorites(user.id);

&nbsp;   const achievements = await getAchievements(user.id);

&nbsp;   

&nbsp;   return res.render('dashboard-viewer', { user, watchedStreams, favoriteStreamers, achievements });

&nbsp; }

});

```



\### 3. \*\*Système de Tasks avec Vérification Twitch\*\*



```javascript

// Valider une task "Regarder X minutes de stream"

app.post('/api/tasks/:taskId/validate', requireAuth, async (req, res) => {

&nbsp; const { taskId } = req.params;

&nbsp; const user = req.session.user;

&nbsp; 

&nbsp; const \[\[task]] = await db.query('SELECT \* FROM tasks WHERE id = ?', \[taskId]);

&nbsp; 

&nbsp; // Validation selon le type de task

&nbsp; switch (task.type) {

&nbsp;   case 'watch\_stream':

&nbsp;     // Vérifie via Twitch API si le user a bien watch

&nbsp;     const watched = await verifyWatchTime(

&nbsp;       user.twitch\_id, 

&nbsp;       task.target\_streamer, 

&nbsp;       task.required\_minutes

&nbsp;     );

&nbsp;     

&nbsp;     if (watched) {

&nbsp;       await awardPoints(user.id, task.reward\_points);

&nbsp;       await completeTask(user.id, taskId);

&nbsp;       return res.json({ success: true, points: task.reward\_points });

&nbsp;     }

&nbsp;     break;

&nbsp;     

&nbsp;   case 'follow\_streamer':

&nbsp;     const follows = await checkFollowStatus(user.access\_token, task.target\_streamer);

&nbsp;     if (follows) {

&nbsp;       await awardPoints(user.id, task.reward\_points);

&nbsp;       await completeTask(user.id, taskId);

&nbsp;     }

&nbsp;     break;

&nbsp;     

&nbsp;   case 'visit\_profile':

&nbsp;     // Simple track côté serveur

&nbsp;     await trackProfileVisit(user.id, task.target\_profile);

&nbsp;     await awardPoints(user.id, task.reward\_points);

&nbsp;     break;

&nbsp; }

});

```



\### 4. \*\*Live Embed avec Tracking\*\*



```javascript

// Page de watching avec tracking automatique

app.get('/watch/:streamer', requireAuth, async (req, res) => {

&nbsp; const { streamer } = req.params;

&nbsp; const user = req.session.user;

&nbsp; 

&nbsp; // Enregistre le début du watching

&nbsp; await db.execute(`

&nbsp;   INSERT INTO watch\_sessions (user\_id, streamer\_login, started\_at)

&nbsp;   VALUES (?, ?, NOW())

&nbsp; `, \[user.id, streamer]);

&nbsp; 

&nbsp; // Récupère le stream live

&nbsp; const streamData = await getStreamData(streamer);

&nbsp; 

&nbsp; res.render('watch', { 

&nbsp;   user, 

&nbsp;   streamer, 

&nbsp;   streamData,

&nbsp;   sessionId: generateSessionId() 

&nbsp; });

});



// Ping pour tracker le temps de visionnage

app.post('/api/watch/ping', requireAuth, async (req, res) => {

&nbsp; const { sessionId } = req.body;

&nbsp; 

&nbsp; await db.execute(`

&nbsp;   UPDATE watch\_sessions 

&nbsp;   SET last\_ping = NOW(), 

&nbsp;       total\_minutes = TIMESTAMPDIFF(MINUTE, started\_at, NOW())

&nbsp;   WHERE session\_id = ?

&nbsp; `, \[sessionId]);

&nbsp; 

&nbsp; // Check si une task est complétée

&nbsp; await checkWatchTasks(req.session.user.id);

&nbsp; 

&nbsp; res.json({ success: true });

});

```



---



\## 🎮 Gamification Avancée



\### Système de Récompenses



```javascript

// Types de récompenses

const REWARDS = {

&nbsp; VISIT\_PROFILE: 10,

&nbsp; WATCH\_5MIN: 25,

&nbsp; WATCH\_30MIN: 100,

&nbsp; WATCH\_60MIN: 250,

&nbsp; FOLLOW\_STREAMER: 50,

&nbsp; CHAT\_MESSAGE: 15,

&nbsp; SHARE\_STREAM: 75,

&nbsp; DISCOVER\_NEW\_STREAMER: 40,

&nbsp; DAILY\_LOGIN: 20,

&nbsp; WEEKLY\_STREAK: 500

};



// Système de niveaux

const LEVELS = \[

&nbsp; { level: 1, required\_points: 0, title: 'Novice' },

&nbsp; { level: 2, required\_points: 100, title: 'Explorateur' },

&nbsp; { level: 3, required\_points: 500, title: 'Habitué' },

&nbsp; { level: 4, required\_points: 1500, title: 'Vétéran' },

&nbsp; { level: 5, required\_points: 5000, title: 'Légende' }

];



// Attribution automatique de niveau

async function updateUserLevel(userId) {

&nbsp; const \[\[user]] = await db.query('SELECT points FROM users WHERE id = ?', \[userId]);

&nbsp; const newLevel = LEVELS.filter(l => l.required\_points <= user.points).pop();

&nbsp; 

&nbsp; await db.execute('UPDATE users SET level = ? WHERE id = ?', \[newLevel.level, userId]);

&nbsp; 

&nbsp; // Notification

&nbsp; await createNotification(userId, {

&nbsp;   type: 'level\_up',

&nbsp;   title: 'Niveau supérieur !',

&nbsp;   message: `Tu es maintenant ${newLevel.title} !`,

&nbsp;   icon: '🎉'

&nbsp; });

}

```



\### Achievements



```javascript

// Système de badges

const ACHIEVEMENTS = {

&nbsp; FIRST\_WATCH: {

&nbsp;   id: 'first\_watch',

&nbsp;   name: 'Premier Visionnage',

&nbsp;   description: 'Regarder ton premier stream',

&nbsp;   icon: '🎬',

&nbsp;   points: 50

&nbsp; },

&nbsp; NIGHT\_OWL: {

&nbsp;   id: 'night\_owl',

&nbsp;   name: 'Oiseau de Nuit',

&nbsp;   description: 'Regarder un stream après minuit',

&nbsp;   icon: '🦉',

&nbsp;   points: 100

&nbsp; },

&nbsp; SOCIAL\_BUTTERFLY: {

&nbsp;   id: 'social\_butterfly',

&nbsp;   name: 'Papillon Social',

&nbsp;   description: 'Visiter 10 profils différents',

&nbsp;   icon: '🦋',

&nbsp;   points: 150

&nbsp; },

&nbsp; MARATHON\_VIEWER: {

&nbsp;   id: 'marathon\_viewer',

&nbsp;   name: 'Marathon Viewer',

&nbsp;   description: 'Regarder 5 heures de stream en une journée',

&nbsp;   icon: '🏃',

&nbsp;   points: 500

&nbsp; }

};

```



---



\## 🔐 Sécurité et Permissions



\### Middleware d'authentification robuste



```javascript

// Vérification d'auth simple

function requireAuth(req, res, next) {

&nbsp; if (!req.session.user) {

&nbsp;   return res.redirect('/auth/twitch');

&nbsp; }

&nbsp; next();

}



// Vérification avec refresh du token Twitch

async function requireAuthWithRefresh(req, res, next) {

&nbsp; if (!req.session.user) {

&nbsp;   return res.redirect('/auth/twitch');

&nbsp; }

&nbsp; 

&nbsp; // Vérifie si le token Twitch est toujours valide

&nbsp; const valid = await validateTwitchToken(req.session.access\_token);

&nbsp; 

&nbsp; if (!valid) {

&nbsp;   // Token expiré → refresh ou redirect

&nbsp;   const newToken = await refreshTwitchToken(req.session.refresh\_token);

&nbsp;   

&nbsp;   if (newToken) {

&nbsp;     req.session.access\_token = newToken;

&nbsp;     await req.session.save();

&nbsp;   } else {

&nbsp;     // Impossible de refresh → nouvelle auth

&nbsp;     return res.redirect('/auth/twitch');

&nbsp;   }

&nbsp; }

&nbsp; 

&nbsp; next();

}



// Vérification rôle streamer

function requireStreamer(req, res, next) {

&nbsp; if (!req.session.user || req.session.user.role !== 'streamer') {

&nbsp;   return res.status(403).json({ error: 'Accès réservé aux streamers' });

&nbsp; }

&nbsp; next();

}



// Vérification admin

function requireAdmin(req, res, next) {

&nbsp; if (!req.session.user || req.session.user.role !== 'admin') {

&nbsp;   return res.status(403).json({ error: 'Accès réservé aux admins' });

&nbsp; }

&nbsp; next();

}

```



---



\## 📱 Fonctionnalités Additionnelles Recommandées



\### 1. \*\*Système de Follow natif\*\*

```javascript

// Permettre aux users de follow des streamers sur ton site

// (en plus ou à la place de Twitch)

app.post('/api/follow/:streamer', requireAuth, async (req, res) => {

&nbsp; const { streamer } = req.params;

&nbsp; const user = req.session.user;

&nbsp; 

&nbsp; await db.execute(`

&nbsp;   INSERT INTO follows (follower\_id, streamer\_login, followed\_at)

&nbsp;   VALUES (?, ?, NOW())

&nbsp;   ON DUPLICATE KEY UPDATE followed\_at = NOW()

&nbsp; `, \[user.id, streamer]);

&nbsp; 

&nbsp; // Task reward

&nbsp; await awardPoints(user.id, REWARDS.FOLLOW\_STREAMER);

&nbsp; 

&nbsp; res.json({ success: true });

});

```



\### 2. \*\*Feed personnalisé\*\*

```javascript

// Feed basé sur les follows et l'historique

app.get('/api/feed', requireAuth, async (req, res) => {

&nbsp; const user = req.session.user;

&nbsp; 

&nbsp; // Streamers followés

&nbsp; const \[followed] = await db.query(`

&nbsp;   SELECT s.\* FROM follows f

&nbsp;   JOIN users s ON f.streamer\_login = s.login

&nbsp;   WHERE f.follower\_id = ?

&nbsp;   ORDER BY f.followed\_at DESC

&nbsp; `, \[user.id]);

&nbsp; 

&nbsp; // Streamers populaires

&nbsp; const \[trending] = await db.query(`

&nbsp;   SELECT u.\*, COUNT(w.id) as viewers

&nbsp;   FROM users u

&nbsp;   LEFT JOIN watch\_sessions w ON u.login = w.streamer\_login

&nbsp;   WHERE u.role = 'streamer'

&nbsp;     AND w.started\_at > DATE\_SUB(NOW(), INTERVAL 24 HOUR)

&nbsp;   GROUP BY u.id

&nbsp;   ORDER BY viewers DESC

&nbsp;   LIMIT 10

&nbsp; `);

&nbsp; 

&nbsp; // Recommandations basées sur l'historique

&nbsp; const \[recommended] = await db.query(`

&nbsp;   SELECT DISTINCT s.\* FROM users s

&nbsp;   JOIN watch\_sessions w1 ON s.login = w1.streamer\_login

&nbsp;   WHERE w1.user\_id IN (

&nbsp;     SELECT DISTINCT w2.user\_id FROM watch\_sessions w2

&nbsp;     WHERE w2.streamer\_login IN (

&nbsp;       SELECT DISTINCT streamer\_login FROM watch\_sessions

&nbsp;       WHERE user\_id = ?

&nbsp;     )

&nbsp;   )

&nbsp;   AND s.id != ?

&nbsp;   LIMIT 5

&nbsp; `, \[user.id, user.id]);

&nbsp; 

&nbsp; res.json({ followed, trending, recommended });

});

```



\### 3. \*\*Notifications en temps réel\*\*

```javascript

// WebSocket pour notifications live

const io = require('socket.io')(server);



io.on('connection', (socket) => {

&nbsp; socket.on('authenticate', async (userId) => {

&nbsp;   socket.userId = userId;

&nbsp;   socket.join(`user:${userId}`);

&nbsp;   

&nbsp;   // Notif quand un streamer suivi est live

&nbsp;   const follows = await getFollowedStreamers(userId);

&nbsp;   follows.forEach(streamer => {

&nbsp;     socket.join(`streamer:${streamer.login}`);

&nbsp;   });

&nbsp; });

});



// Quand un streamer passe live

async function notifyStreamLive(streamerLogin) {

&nbsp; const streamer = await getStreamerByLogin(streamerLogin);

&nbsp; 

&nbsp; io.to(`streamer:${streamerLogin}`).emit('stream\_live', {

&nbsp;   streamer: streamer.display\_name,

&nbsp;   title: streamer.stream\_title,

&nbsp;   game: streamer.game\_name,

&nbsp;   thumbnail: streamer.thumbnail\_url

&nbsp; });

}

```



---



\## 🎨 UX/UI Recommandations



\### 1. \*\*Landing Page différenciée\*\*



```html

<!-- Pour visiteurs non connectés -->

<div class="hero">

&nbsp; <h1>🎮 Rejoins la Team Twitch Francophone</h1>

&nbsp; <p>Découvre, regarde et supporte tes streamers préférés</p>

&nbsp; 

&nbsp; <a href="/auth/twitch" class="cta-button">

&nbsp;   <i class="fab fa-twitch"></i>

&nbsp;   Se connecter avec Twitch

&nbsp; </a>

&nbsp; 

&nbsp; <div class="features">

&nbsp;   <div class="feature">

&nbsp;     <span>🎁</span>

&nbsp;     <h3>Gagne des récompenses</h3>

&nbsp;     <p>En regardant et supportant les streamers</p>

&nbsp;   </div>

&nbsp;   <div class="feature">

&nbsp;     <span>🏆</span>

&nbsp;     <h3>Débloquer des achievements</h3>

&nbsp;     <p>Progresse et débloque des badges exclusifs</p>

&nbsp;   </div>

&nbsp;   <div class="feature">

&nbsp;     <span>👥</span>

&nbsp;     <h3>Découvre la communauté</h3>

&nbsp;     <p>Trouve de nouveaux streamers à suivre</p>

&nbsp;   </div>

&nbsp; </div>

</div>

```



\### 2. \*\*Onboarding streamer\*\*



```html

<!-- /onboarding/streamer -->

<div class="onboarding">

&nbsp; <h1>🎉 Bienvenue sur Stream Team !</h1>

&nbsp; <p>Configure ton profil en quelques étapes</p>

&nbsp; 

&nbsp; <form action="/api/onboarding/streamer" method="POST">

&nbsp;   <div class="step active" data-step="1">

&nbsp;     <h2>📝 Présente-toi</h2>

&nbsp;     <textarea name="bio" placeholder="Dis-nous qui tu es, ce que tu streams..."></textarea>

&nbsp;     

&nbsp;     <h3>🎮 Tes jeux principaux</h3>

&nbsp;     <input type="text" name="games" placeholder="Valorant, League of Legends..." />

&nbsp;   </div>

&nbsp;   

&nbsp;   <div class="step" data-step="2">

&nbsp;     <h2>⏰ Ton planning</h2>

&nbsp;     <p>Aide les viewers à savoir quand tu streams</p>

&nbsp;     <!-- Schedule picker -->

&nbsp;   </div>

&nbsp;   

&nbsp;   <div class="step" data-step="3">

&nbsp;     <h2>🔗 Liens sociaux</h2>

&nbsp;     <input type="url" name="twitter" placeholder="Twitter" />

&nbsp;     <input type="url" name="youtube" placeholder="YouTube" />

&nbsp;     <input type="url" name="discord" placeholder="Discord" />

&nbsp;   </div>

&nbsp;   

&nbsp;   <button type="submit">Finaliser mon profil</button>

&nbsp; </form>

</div>

```



\### 3. \*\*Widget "Regarde et gagne"\*\*



```html

<!-- Affiché pendant le watching -->

<div class="watch-rewards">

&nbsp; <h3>⏱️ Temps de visionnage</h3>

&nbsp; <div class="progress-bar">

&nbsp;   <div class="progress" style="width: 45%"></div>

&nbsp; </div>

&nbsp; <p>9 minutes / 20 minutes</p>

&nbsp; 

&nbsp; <div class="next-reward">

&nbsp;   <span>Prochain palier : 🎁 100 points</span>

&nbsp; </div>

&nbsp; 

&nbsp; <div class="tasks-available">

&nbsp;   <h4>📋 Tasks disponibles</h4>

&nbsp;   <div class="task">

&nbsp;     <span>💬</span>

&nbsp;     <p>Écris un message dans le chat</p>

&nbsp;     <strong>+15 pts</strong>

&nbsp;   </div>

&nbsp;   <div class="task">

&nbsp;     <span>❤️</span>

&nbsp;     <p>Follow ce streamer</p>

&nbsp;     <strong>+50 pts</strong>

&nbsp;   </div>

&nbsp; </div>

</div>

```



---



\## 📊 Analytics et Tracking



\### Dashboard Admin



```javascript

// Statistiques globales

app.get('/admin/stats', requireAdmin, async (req, res) => {

&nbsp; const stats = {

&nbsp;   totalUsers: await db.query('SELECT COUNT(\*) FROM users'),

&nbsp;   totalStreamers: await db.query('SELECT COUNT(\*) FROM users WHERE role = "streamer"'),

&nbsp;   totalViewers: await db.query('SELECT COUNT(\*) FROM users WHERE role = "viewer"'),

&nbsp;   

&nbsp;   activeToday: await db.query(`

&nbsp;     SELECT COUNT(\*) FROM users 

&nbsp;     WHERE last\_seen > DATE\_SUB(NOW(), INTERVAL 24 HOUR)

&nbsp;   `),

&nbsp;   

&nbsp;   totalWatchTime: await db.query(`

&nbsp;     SELECT SUM(total\_minutes) FROM watch\_sessions

&nbsp;   `),

&nbsp;   

&nbsp;   topStreamers: await db.query(`

&nbsp;     SELECT u.display\_name, COUNT(w.id) as views, SUM(w.total\_minutes) as total\_minutes

&nbsp;     FROM users u

&nbsp;     JOIN watch\_sessions w ON u.login = w.streamer\_login

&nbsp;     WHERE w.started\_at > DATE\_SUB(NOW(), INTERVAL 7 DAY)

&nbsp;     GROUP BY u.id

&nbsp;     ORDER BY views DESC

&nbsp;     LIMIT 10

&nbsp;   `),

&nbsp;   

&nbsp;   taskCompletion: await db.query(`

&nbsp;     SELECT t.name, COUNT(ut.id) as completions

&nbsp;     FROM tasks t

&nbsp;     LEFT JOIN user\_tasks ut ON t.id = ut.task\_id

&nbsp;     GROUP BY t.id

&nbsp;     ORDER BY completions DESC

&nbsp;   `)

&nbsp; };

&nbsp; 

&nbsp; res.render('admin-stats', { stats });

});

```



---



\## 🚀 Plan de Migration



\### Si la branche develop est déjà en prod



1\. \*\*Phase 1 : Dual-auth temporaire (1 mois)\*\*

&nbsp;  - Garder les deux systèmes

&nbsp;  - Afficher un message encourageant la liaison Twitch

&nbsp;  - Offrir bonus de points pour lier le compte Twitch



2\. \*\*Phase 2 : Migration forcée (2 semaines)\*\*

&nbsp;  - Email aux users email/password

&nbsp;  - Obligation de lier un compte Twitch

&nbsp;  - Deadline annoncée



3\. \*\*Phase 3 : Nettoyage\*\*

&nbsp;  - Suppression du système email/password

&nbsp;  - Cleanup de la DB

&nbsp;  - Simplification du code



\### Si develop n'est pas en prod



1\. \*\*NE PAS MERGER develop\*\*

2\. Continuer sur main avec OAuth Twitch uniquement

3\. Implémenter les features recommandées ci-dessus



---



\## ✅ Checklist d'Implémentation



\### Court terme (Sprint 1-2)

\- \[ ] Refuser le merge de develop

\- \[ ] Améliorer l'onboarding Twitch

\- \[ ] Différencier viewer/streamer dès la connexion

\- \[ ] Implémenter le système de points basique

\- \[ ] Créer 5-10 tasks simples



\### Moyen terme (Sprint 3-5)

\- \[ ] Système de levels et achievements

\- \[ ] Feed personnalisé

\- \[ ] Widget "watch \& earn"

\- \[ ] Notifications temps réel

\- \[ ] Dashboard analytics



\### Long terme (Sprint 6+)

\- \[ ] API publique

\- \[ ] Extension navigateur

\- \[ ] Bot Discord

\- \[ ] Mobile app (PWA)

\- \[ ] Programme partenaires streamers



---



\## 💡 Conclusion



\### ❌ À NE PAS FAIRE

\- Merger la branche develop (système email/password)

\- Complexifier l'auth avec plusieurs systèmes

\- Permettre des comptes sans Twitch



\### ✅ À FAIRE

\- \*\*OAuth Twitch comme UNIQUE authentification\*\*

\- Gamification intensive autour de Twitch

\- Tracking précis des interactions

\- Expérience fluide et intégrée

\- Valorisation de la communauté Twitch FR



\### 🎯 Vision

Stream Team doit être \*\*LE\*\* hub central pour la communauté Twitch francophone, pas une énième plateforme générique avec login/password. L'identité Twitch est au cœur de tout.



---



\*Document créé le 22 octobre 2025\*

\*Recommandations stratégiques pour Stream Team HQ\*

