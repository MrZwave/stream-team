require("dotenv").config();
const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const csrf = require('csurf');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
// Indique à Express qu'il est derrière un proxy comme NGINX
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", "./views");

// Port d'écoute
const PORT = process.env.PORT || 3000;

// Connexion à la base de données
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

function requireAdmin(req, res, next) {
  console.log("[requireAdmin] session user =", req.session.user);
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.status(403).json({ error: "Accès refusé" });
  }
  next();
}

// Création du dossier logs si nécessaire
function logCardEvent(message) {
  const logDir = path.join(__dirname, "logs");
  const logPath = path.join(logDir, "cards.log");
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions MySQL
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "streamteam_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 3600 * 1000,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

// ========================================
// 🆕 MIDDLEWARE RÉÉCRITURE D'URL (sans .html)
// ========================================
app.use((req, res, next) => {
  // Si l'URL se termine par .html, rediriger vers l'URL sans extension
  if (req.path.endsWith('.html')) {
    const newPath = req.path.slice(0, -5);
    return res.redirect(301, newPath);
  }
  
  // Routes dynamiques à ignorer (laisse passer vers les routes Express)
  const dynamicRoutes = ['/streamer/', '/api/', '/auth/', '/admin/'];
  if (dynamicRoutes.some(route => req.path.startsWith(route))) {
    return next();
  }
  
  // Si l'URL n'a pas d'extension et n'est pas la racine
  if (!req.path.includes('.') && req.path !== '/') {
    // Vérifie si un fichier .html existe dans frontend/
    const htmlPath = path.join(__dirname, 'frontend', req.path + '.html');
    
    if (fs.existsSync(htmlPath)) {
      return res.sendFile(htmlPath);
    }
  }
  
  next();
});

// ========================================
// HELMET - CSP (Content Security Policy)
// ========================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Nécessaire pour les scripts inline
        "'unsafe-hashes'",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://player.twitch.tv",
        "https://embed.twitch.tv"
      ],
      scriptSrcAttr: ["'unsafe-hashes'"], // Pour les événements inline (ex: onload)
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.gstatic.com",
        "data:"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://static-cdn.jtvnw.net",
        "https://static.twitchcdn.net",
        "blob:"
      ],
      frameSrc: [
        "'self'",
        "https://player.twitch.tv",
        "https://embed.twitch.tv",
        "https://www.twitch.tv"
      ],
      connectSrc: [
        "'self'",
        "https://api.twitch.tv",
        "https://id.twitch.tv",
        "wss://irc-ws.chat.twitch.tv"
      ],
      mediaSrc: [
        "'self'",
        "https:",
        "blob:"
      ],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  noSniff: true,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  },
  crossOriginEmbedderPolicy: false // Important pour Twitch embeds
}));

// ========================================
//  RATE LIMITING - FIX trust proxy
// ========================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requêtes par IP
  standardHeaders: true,
  legacyHeaders: false,
  // FIX CRITIQUE: Désactiver la validation stricte du trust proxy
  validate: {
    trustProxy: false
  },
  // Récupérer la vraie IP depuis X-Forwarded-For (NGINX)
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    return forwarded ? forwarded.split(',')[0].trim() : req.ip;
  },
  message: 'Trop de requêtes depuis cette IP, réessayez dans 15 minutes.',
  // Skip function pour exclure certaines routes du rate limiting
  skip: (req) => {
    // Pas de rate limit sur les pages statiques
    return req.method === 'GET' && !req.path.startsWith('/api/');
  }
});

// Appliquer uniquement sur les routes API
app.use('/api/', limiter);

// ========================================
// 4. CSRF PROTECTION - AVEC EXEMPTIONS
// ========================================

// Créer le middleware CSRF
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600000 // 1 heure
  }
});

// Routes exemptées du CSRF
const csrfExemptions = [
  // OAuth
  '/auth/twitch/callback',
  
  // Webhooks externes
  '/webhooks/',
  
  // Endpoints de lecture (GET safe)
  '/api/auth/status',
  '/api/auth/check',
  '/api/live',
  '/api/streamer/',
  
  // ⚠️ CRITIQUE: Tracking non sensible (pas besoin de CSRF)
  '/api/profile-click',
  
  // Autres endpoints publics non sensibles
  '/api/clips',
  '/api/debug'
];

// Middleware CSRF conditionnel
app.use((req, res, next) => {
  // Skip CSRF pour les GET (safe methods)
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  
  // Skip CSRF pour les routes exemptées
  const isExempted = csrfExemptions.some(path => req.path.startsWith(path));
  if (isExempted) {
    return next();
  }
  
  // Appliquer CSRF pour POST/PUT/DELETE sensibles
  csrfProtection(req, res, next);
});

// Middleware pour passer le token CSRF aux vues
app.use((req, res, next) => {
  // Générer le token seulement si CSRF est actif pour cette route
  try {
    res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
  } catch (err) {
    res.locals.csrfToken = null;
  }
  next();
});

// Logging des tentatives POST sans CSRF (debug)
app.use((req, res, next) => {
  if (req.method === 'POST' && !req.csrfToken) {
    const isExempted = csrfExemptions.some(path => req.path.startsWith(path));
    if (!isExempted) {
      console.log('[Security] POST sans token CSRF:', {
        ip: req.ip || req.headers['x-forwarded-for'],
        path: req.path,
        userAgent: req.headers['user-agent']
      });
    }
  }
  next();
});

  console.log('🔒 Sécurité initialisée : CSRF + CSP + Rate Limiting');

// ========================================
// 🔐 AUTHENTIFICATION TWITCH OAUTH
// ========================================

app.get("/auth/twitch", (req, res) => {
  const redirect_uri = `${process.env.BASE_URL}/auth/twitch/callback`;
  res.redirect(
    `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=code&scope=user:read:email`
  );
});

app.get("/auth/twitch/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  try {
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${process.env.BASE_URL}/auth/twitch/callback`,
      }),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      console.error("[OAuth Error]", tokenJson);
      return res.status(500).send("Failed to get access token");
    }

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${tokenJson.access_token}`,
      },
    });

    const userData = await userRes.json();
    const user = userData?.data?.[0];
    req.session.access_token = tokenJson.access_token;
    if (!user) return res.status(500).send("Failed to fetch user info");

    await db.execute(
      `
      INSERT INTO streamers (twitch_id, login, display_name, profile_image_url, created_at_site)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), profile_image_url = VALUES(profile_image_url)
    `,
      [user.id, user.login, user.display_name, user.profile_image_url]
    );

    const [[streamer]] = await db.query(
      "SELECT id, created_at_site, is_admin FROM streamers WHERE login = ?",
      [user.login]
    );

    req.session.user = {
      id: streamer.id,
      twitch_id: user.id,
      login: user.login,
      display_name: user.display_name,
      profile_image_url: user.profile_image_url,
      created_at_site: streamer.created_at_site,
      is_admin: streamer.is_admin,
    };

    res.redirect("/");
  } catch (e) {
    console.error("[OAuth Error]", e);
    res.status(500).send("Auth error");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// Vérifier l'authentification (utilisé par script.js)
app.get("/api/auth/check", (req, res) => {
  if (req.session && req.session.user) {
    res.json({ 
      authenticated: true, 
      user: req.session.user 
    });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

// Vérifier l'authentification (utilisé par script.js)
app.get("/api/auth/check", (req, res) => {
  if (req.session && req.session.user) {
    res.json({ 
      authenticated: true, 
      user: req.session.user 
    });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

// ⭐ NOUVEAU : Endpoint pour header-auth.js
app.get("/api/auth/status", (req, res) => {
  if (req.session && req.session.user) {
    res.json({
      authenticated: true,
      user: {
        login: req.session.user.login,
        display_name: req.session.user.display_name,
        profile_image_url: req.session.user.profile_image_url
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Après la route /api/auth/check
app.get("/api/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  res.json(req.session.user);
});

app.get("/api/live", async (req, res) => {
  try {
    const [streamers] = await db.query("SELECT login FROM streamers");
    
    if (streamers.length === 0) {
      return res.json({ liveData: [] });
    }
    
    const token = await getAppAccessToken();
    const logins = streamers.map(s => s.login);
    const liveStreams = [];
    
    for (let i = 0; i < logins.length; i += 100) {
      const batch = logins.slice(i, i + 100);
      const queryString = batch.map(l => `user_login=${encodeURIComponent(l)}`).join('&');
      
      const streamsRes = await fetch(
        `https://api.twitch.tv/helix/streams?${queryString}`,
        {
          headers: {
            "Client-ID": process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${token}`,
          },
        }
      );
      
      const streamsData = await streamsRes.json();
      
      if (streamsData.data && streamsData.data.length > 0) {
        liveStreams.push(...streamsData.data);
      }
    }
    
    console.log(`[API /live] ${liveStreams.length} streamers en live`);
    res.json({ liveData: liveStreams });
  } catch (err) {
    console.error("[API /live] Erreur:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const logins = req.query.login;
    if (!logins) {
      return res.json({ data: [] });
    }

    const loginArray = Array.isArray(logins) ? logins : [logins];
    const token = await getAppAccessToken();
    
    const queryString = loginArray.map(l => `login=${encodeURIComponent(l)}`).join('&');
    const twitchRes = await fetch(
      `https://api.twitch.tv/helix/users?${queryString}`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await twitchRes.json();
    res.json(data);
  } catch (err) {
    console.error("[API /users]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/profile", (req, res) => {
  const user = req.query.user;
  if (!user) {
    return res.redirect("/");
  }
  res.redirect(`/streamer/${user}`);
});

// ========================================
// 📡 API TWITCH
// ========================================

async function getAppAccessToken() {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  if (!data.access_token)
    throw new Error("Impossible d'obtenir le token d'application");
  return data.access_token;
}

async function getUserId(login) {
  const token = await getAppAccessToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await res.json();
  const user = data.data && data.data[0];
  if (!user) throw new Error(`Utilisateur introuvable: ${login}`);
  return user.id;
}

async function getUserData(login) {
  const token = await getAppAccessToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await res.json();
  const user = data.data && data.data[0];
  if (!user) throw new Error(`Utilisateur introuvable: ${login}`);
  return user;
}

app.get("/api/clips", async (req, res) => {
  const login = req.query.login;
  if (!login) return res.status(400).json({ error: "Login manquant" });

  try {
    const accessToken = await getAppAccessToken();
    const broadcasterId = await getUserId(login);

    const twitchRes = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await twitchRes.json();

    // Enregistrement en BDD
    if (Array.isArray(data.data)) {
      for (const clip of data.data) {
        try {
          await db.execute(
            `
            INSERT IGNORE INTO twitch_clips 
            (streamer_login, twitch_clip_id, title, thumbnail_url, url)
            VALUES (?, ?, ?, ?, ?)
          `,
            [login, clip.id, clip.title, clip.thumbnail_url, clip.url]
          );
        } catch (dbErr) {
          console.error("[CLIP DB ERROR]", dbErr);
        }
      }
    }

    res.json(data);
  } catch (err) {
    console.error("[CLIPS]", err);
    res.status(500).json({ error: "Erreur lors de la récupération des clips" });
  }
});

app.get("/api/followers", async (req, res) => {
  const login = req.query.login;
  if (!login) return res.status(400).json({ error: "Login manquant" });

  try {
    const userId = await getUserId(login);
    const accessToken = await getAppAccessToken();

    const twitchRes = await fetch(
      `https://api.twitch.tv/helix/users/follows?to_id=${userId}`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await twitchRes.json();
    res.json({ total: data.total || 0 });
  } catch (err) {
    console.error("[FOLLOWERS]", err);
    res.status(500).json({ error: "Erreur followers" });
  }
});

app.get("/api/profile-stats", async (req, res) => {
  const login = req.query.login;
  if (!login) return res.status(400).json({ error: "Login requis" });

  try {
    await db.query("UPDATE streamers SET clicks = clicks + 1 WHERE login = ?", [
      login,
    ]);

    const [[liveCountRow]] = await db.query(
      "SELECT COUNT(*) AS count FROM live_streams WHERE login = ?",
      [login]
    );

    const [[clicksRow]] = await db.query(
      "SELECT clicks FROM streamers WHERE login = ?",
      [login]
    );

    const [[clipsRow]] = await db.query(
      "SELECT COUNT(*) AS count FROM twitch_clips WHERE streamer_login = ?",
      [login]
    );

    const [[salveRow]] = await db.query(
      "SELECT salves FROM streamers WHERE login = ?",
      [login]
    );

    res.json({
      liveCount: liveCountRow.count || 0,
      clicks: clicksRow?.clicks || 0,
      clips: clipsRow.count || 0,
      salves: salveRow?.salves || 0,
    });
  } catch (err) {
    console.error("[API /profile-stats]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ========================================
// 🔍 RECHERCHE & STREAMERS
// ========================================

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q)
    return res.json({ streamers: [], categories: [], error: "Missing query" });

  try {
    const [rows] = await db.query(
      "SELECT DISTINCT login, display_name, profile_image_url FROM streamers WHERE LOWER(login) LIKE ? OR LOWER(display_name) LIKE ? LIMIT 5",
      [`%${q}%`, `%${q}%`]
    );

    const streamers = rows.map((row) => ({
      login: row.login,
      display_name: row.display_name,
      profile_image_url: row.profile_image_url,
    }));

    res.json({ streamers, categories: [] });
  } catch (err) {
    console.error("[SEARCH]", err);
    res.status(500).json({ error: "Erreur lors de la recherche" });
  }
});

app.get("/api/streamers", async (req, res) => {
  try {
    const [streamers] = await db.query(
      `SELECT login, display_name, profile_image_url
       FROM streamers
       WHERE profile_image_url IS NOT NULL
       ORDER BY created_at_site DESC
       LIMIT 50`
    );

    const enhanced = await Promise.all(
      streamers.map(async (s) => {
        const [[stats]] = await db.query(
          "SELECT clicks, salves FROM streamers WHERE login = ?",
          [s.login]
        );
        return {
          ...s,
          clicks: stats?.clicks || 0,
          salves: stats?.salves || 0,
        };
      })
    );

    res.json({ streamers: enhanced });
  } catch (err) {
    console.error("[/api/streamers]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/all_dbs", async (req, res) => {
  try {
    const [clipsRows] = await db.query(
      "SELECT DISTINCT streamer_login FROM twitch_clips LIMIT 10"
    );
    const [streamersRows] = await db.query("SELECT login FROM streamers");

    res.json({
      clips: clipsRows,
      streamers: streamersRows,
    });
  } catch (err) {
    console.error("[/api/all_dbs]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/save", (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ error: "Login requis" });

  db.query(
    "UPDATE streamers SET salves = salves + 1 WHERE login = ?",
    [login],
    (err) => {
      if (err) {
        console.error("[SAVE]", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      res.json({ success: true });
    }
  );
});

app.get("/api/saved", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Non connecté" });
  }

  res.json({ streamers: req.session.saved || [] });
});

// ========================================
// 📡 API STREAMER DATA
// ========================================

// Route pour récupérer les données d'un streamer
app.get("/api/streamer/:login", async (req, res) => {
  try {
    const { login } = req.params;

    // 1. Récupérer les données Twitch
    const token = await getAppAccessToken();
    
    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const userData = await userRes.json();
    const user = userData.data && userData.data[0];

    if (!user) {
      return res.status(404).json({ error: "Streamer introuvable" });
    }

    // 2. Vérifier si le streamer est en live
    const streamRes = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const streamData = await streamRes.json();
    user.is_live = streamData.data && streamData.data.length > 0;

    // 3. Récupérer les clips
    const clipsRes = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${user.id}&first=12`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const clipsData = await clipsRes.json();
    const clips = clipsData.data || [];

    // 4. Récupérer les stats depuis la BDD
    const [[userStats]] = await db.query(
      "SELECT clicks, salves FROM streamers WHERE login = ?",
      [login]
    );

    // 5. Incrémenter le compteur de clics
    if (!userStats) {
      // Si le streamer n'existe pas en BDD, l'ajouter
      await db.query(
        `INSERT INTO streamers (login, display_name, profile_image_url, clicks) 
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE clicks = clicks + 1`,
        [login, user.display_name, user.profile_image_url]
      );
    }

    // 6. Retourner les données
    res.json({
      userData: user,
      userStats: userStats || { clicks: 0, salves: 0 },
      clips: clips
    });

  } catch (err) {
    console.error("[API /api/streamer]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ========================================
// 📊 API TRACKING - Comptage des clics
//         SANS CSRF (tracking non sensible)
// ========================================

// ⚠️ IMPORTANT: /api/profile-click est déjà exempté du CSRF dans le middleware global
// Il ne faut donc PAS ajouter csrfProtection dans la route

app.post("/api/profile-click", async (req, res) => {
  try {
    const { login } = req.body; // Utiliser 'login' au lieu de 'targetId'
    
    if (!login) {
      return res.status(400).json({ error: "Login manquant" });
    }
    
    // Vérifier si le streamer existe dans la DB
    const [rows] = await db.query(
      "SELECT id, clicks FROM streamers WHERE login = ?",
      [login]
    );
    
    if (rows.length > 0) {
      // Incrémenter le compteur
      await db.query(
        "UPDATE streamers SET clicks = clicks + 1 WHERE login = ?",
        [login]
      );
    } else {
      // Créer l'entrée avec 1 clic
      await db.query(
        "INSERT INTO streamers (login, clicks) VALUES (?, 1)",
        [login]
      );
    }
    
    console.log(`[Profile Click] Vue enregistrée pour ${login}`);
    
    res.json({ success: true });
  } catch (err) {
    console.error("[POST /api/profile-click]", err);
    res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
});

// ========================================
// ⭐ API SALVE - Action sensible
//         AVEC protection CSRF
// ========================================

app.post("/api/salve", csrfProtection, async (req, res) => {
  try {
    // Vérifier l'authentification
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const senderId = req.session.user.id;
    const { login } = req.body; // Utiliser 'login' comme dans le frontend
    
    // Validation
    if (!login) {
      return res.status(400).json({ error: "Login manquant" });
    }
    
    // Récupérer l'ID du destinataire depuis son login
    const [targetRows] = await db.query(
      "SELECT id FROM users WHERE login = ?",
      [login]
    );
    
    if (targetRows.length === 0) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }
    
    const targetId = targetRows[0].id;
    
    // Vérifier que l'utilisateur ne s'envoie pas à lui-même
    if (senderId === targetId) {
      return res.status(400).json({ error: "Impossible de s'envoyer une salve" });
    }
    
    // Vérifier si une salve existe déjà (éviter le spam)
    const [existingSalve] = await db.query(
      "SELECT id FROM salves WHERE sender_id = ? AND receiver_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)",
      [senderId, targetId]
    );
    
    if (existingSalve.length > 0) {
      return res.status(429).json({ error: "Tu as déjà envoyé une salve à cet utilisateur aujourd'hui" });
    }
    
    // Insérer la salve
    await db.query(
      "INSERT INTO salves (sender_id, receiver_id) VALUES (?, ?)",
      [senderId, targetId]
    );
    
    // Incrémenter le compteur de salves du destinataire
    await db.query(
      "UPDATE streamers SET salves = salves + 1 WHERE login = ?",
      [login]
    );
    
    console.log(`[Salve] ${senderId} → ${targetId} (${login})`);
    
    res.json({
      success: true,
      message: "Salve envoyée !",
      receiver: login
    });
  } catch (err) {
    console.error("[POST /api/salve]", err);
    
    // Si c'est une erreur CSRF
    if (err.code === 'EBADCSRFTOKEN') {
      return res.status(403).json({ error: "Token CSRF invalide" });
    }
    
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ========================================
// 🔔 NOTIFICATIONS
// ========================================

app.get("/api/notifications", async (req, res) => {
  try {
    const userId = req.session.user?.id;

    let query = `
      SELECT n.id, n.title, n.message, n.icon, n.category, n.created_at
      FROM notifications n
    `;

    let params = [];

    if (userId) {
      query += `
        LEFT JOIN user_notifications un
          ON n.id = un.notification_id AND un.user_id = ?
        WHERE un.notification_id IS NULL
      `;
      params = [userId];
    }

    query += " ORDER BY n.created_at DESC LIMIT 5";

    const [notifications] = await db.query(query, params);
    res.json(notifications);
  } catch (err) {
    console.error("Erreur notifications:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/notifications/mark-read", async (req, res) => {
  try {
    const userId = req.session.user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    await db.query(
      `
      INSERT INTO user_notifications (user_id, notification_id, read_at)
      SELECT ?, n.id, NOW()
      FROM notifications n
      LEFT JOIN user_notifications un ON n.id = un.notification_id AND un.user_id = ?
      WHERE un.notification_id IS NULL
    `,
      [userId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Erreur mark-read:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ========================================
// 👑 ADMIN PANEL
// ========================================

app.get("/api/admin/streamers", requireAdmin, async (req, res) => {
  try {
    const [streamers] = await db.query(
      "SELECT id, login, display_name, is_admin FROM streamers"
    );
    res.json(streamers);
  } catch (err) {
    console.error("Erreur /api/admin/streamers:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/admin/streamers/:id/toggle-admin", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { is_admin } = req.body;

  try {
    await db.query("UPDATE streamers SET is_admin = ? WHERE id = ?", [is_admin ? 1 : 0, id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur toggle admin:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/admin/notifications", requireAdmin, async (req, res) => {
  const { title, message, icon, category } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: "Title et message requis" });
  }

  try {
    await db.query(
      "INSERT INTO notifications (title, message, icon, category) VALUES (?, ?, ?, ?)",
      [title, message, icon || "🔔", category || "system"]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur création notif:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// CRUD Cartes
app.get("/api/admin/cards", requireAdmin, async (req, res) => {
  try {
    const [cards] = await db.query("SELECT * FROM cards ORDER BY id DESC");
    res.json(cards);
  } catch (err) {
    console.error("[GET /api/admin/cards] Erreur SQL :", err);
    res.status(500).json({ error: "Erreur lors de la récupération des cartes" });
  }
});

app.post("/api/admin/cards", requireAdmin, async (req, res) => {
  const { name, rarity, image_url, description, unlock_condition } = req.body;

  if (!name || !rarity) {
    return res.status(400).json({ error: "Nom et rareté requis." });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO cards (name, rarity, image_url, description, unlock_condition) VALUES (?, ?, ?, ?, ?)`,
      [name, rarity, image_url || null, description || null, unlock_condition || null]
    );

    logCardEvent(`[CREATE] Carte ajoutée : ID=${result.insertId}, Nom=${name}, Rareté=${rarity}`);
    res.json({ success: true, cardId: result.insertId });
  } catch (err) {
    console.error("[POST /api/admin/cards] Erreur SQL :", err);
    logCardEvent(`[ERROR CREATE] ${err.message}`);
    res.status(500).json({ error: "Erreur lors de la création de la carte." });
  }
});

app.put("/api/admin/cards/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, rarity, image_url, description, unlock_condition } = req.body;

  if (!name || !rarity) {
    return res.status(400).json({ error: "Nom et rareté requis." });
  }

  try {
    const [result] = await db.query(
      `UPDATE cards SET name = ?, rarity = ?, image_url = ?, description = ?, unlock_condition = ? WHERE id = ?`,
      [name, rarity, image_url || null, description || null, unlock_condition || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    logCardEvent(`[UPDATE] Carte modifiée : ID=${id}, Nom=${name}, Rareté=${rarity}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/admin/cards/:id] Erreur SQL :", err);
    logCardEvent(`[ERROR UPDATE] ${err.message}`);
    res.status(500).json({ error: "Erreur lors de la modification de la carte." });
  }
});

app.delete("/api/admin/cards/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const [result] = await db.query(`DELETE FROM cards WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    logCardEvent(`[DELETE] Carte supprimée : ID=${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/admin/cards/:id] Erreur SQL :", err);
    logCardEvent(`[ERROR DELETE] ${err.message}`);
    res.status(500).json({ error: "Erreur lors de la suppression de la carte." });
  }
});

// CRUD Quêtes
app.get("/api/admin/quests", requireAdmin, async (req, res) => {
  try {
    const [quests] = await db.query("SELECT * FROM quests ORDER BY id DESC");
    res.json(quests);
  } catch (err) {
    console.error("[GET /api/admin/quests] Erreur SQL :", err);
    res.status(500).json({ error: "Erreur lors de la récupération des quêtes." });
  }
});

app.post("/api/admin/quests", requireAdmin, async (req, res) => {
  const { title, description, reward_points, is_active } = req.body;

  if (!title || reward_points === undefined) {
    return res.status(400).json({ error: "Titre et points de récompense requis." });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO quests (title, description, reward_points, is_active) VALUES (?, ?, ?, ?)`,
      [title, description || null, reward_points, is_active ? 1 : 0]
    );

    res.json({ success: true, questId: result.insertId });
  } catch (err) {
    console.error("[POST /api/admin/quests] Erreur SQL :", err);
    res.status(500).json({ error: "Erreur lors de la création de la quête." });
  }
});

app.put("/api/admin/quests/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, description, reward_points, is_active } = req.body;

  if (!title || reward_points === undefined) {
    return res.status(400).json({ error: "Titre et points de récompense requis." });
  }

  try {
    const [result] = await db.query(
      `UPDATE quests SET title = ?, description = ?, reward_points = ?, is_active = ? WHERE id = ?`,
      [title, description || null, reward_points, is_active ? 1 : 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Quête introuvable." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/admin/quests/:id] Erreur SQL :", err);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

app.delete("/api/admin/quests/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const [result] = await db.query(`DELETE FROM quests WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Quête introuvable." });
    }

    res.json({ success: true, message: "Quête supprimée." });
  } catch (err) {
    console.error("[DELETE /api/admin/quests/:id] Erreur SQL :", err);
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

// ========================================
// 🎭 PAGES DYNAMIQUES
// ========================================

app.get("/test", (req, res) => {
  res.render("test", { username: "MrZwave" });
});

// ========================================
// 📄 PAGE STREAMER (HTML pur)
// ========================================
app.get("/streamer/:name", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "streamer.html"));
});

// ========================================
// 🛠️ DEBUG & UTILS
// ========================================

app.get("/api/debug", (req, res) => {
  res.send("✅ API en ligne et à jour");
});

app.get("/api/debug-session", (req, res) => {
  res.json({
    sessionUser: req.session.user || null,
  });
});

// Fichiers statiques (frontend)
app.use(express.static(path.join(__dirname, "frontend")));

// Fallback error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (req.path.startsWith("/api/"))
    return res.status(500).json({ error: "Internal Server Error" });
  next();
});

// ========================================
// 5. GESTIONNAIRE D'ERREURS CSRF
// ========================================

// Gestionnaire d'erreur CSRF
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.error('[CSRF] Token invalide:', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    return res.status(403).json({
      error: 'Token CSRF invalide ou expiré',
      message: 'Veuillez rafraîchir la page et réessayer'
    });
  }
  
  next(err);
});

// ========================================
// 🚀 LANCEMENT SERVEUR
// ========================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
  console.log("📍 OAuth Twitch configuré");
  console.log("🔗 URL: " + (process.env.BASE_URL || "http://localhost:3000"));
});
