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
        "'unsafe-inline'",
        "'unsafe-hashes'",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://player.twitch.tv",
        "https://embed.twitch.tv",
        "https://www.googletagmanager.com",
        "https://www.google-analytics.com"
      ],
      scriptSrcAttr: ["'unsafe-hashes'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com",
        "https://cdn.jsdelivr.net"
      ],
      fontSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
        "data:"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "https://static-cdn.jtvnw.net",
        "https://static.twitchcdn.net",
        "https://clips-media-assets2.twitch.tv",
        "https://www.google-analytics.com",
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
        "wss://irc-ws.chat.twitch.tv",
        "https://gql.twitch.tv",
        "https://www.google-analytics.com",
        "https://region1.google-analytics.com"
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
  crossOriginEmbedderPolicy: false
}));

// ========================================
// RATE LIMITING - IPv6 SAFE
// ========================================
function ipKeyGenerator(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;
  return ip;
}

// ✅ Indique qu'on est derrière un proxy (NGINX)
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator, // ✅ compatible IPv4 / IPv6
  message: 'Trop de requêtes depuis cette IP, réessayez dans 15 minutes.',
  skip: (req) => {
    // Pas de rate limit sur les pages statiques
    return req.method === 'GET' && !req.path.startsWith('/api/');
  }
});

app.use('/api/', limiter);

// ========================================
// CSRF PROTECTION - SIMPLE & STABLE (SESSION-BASED)
// ========================================
// ⚠️ IMPORTANT : express-session doit être configuré AVANT ce bloc
const csrfProtection = csrf({
  cookie: false, // ✅ évite "misconfigured csrf"
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS']
});

const csrfExemptions = [
  '/auth/twitch/callback',
  '/api/auth/status',
  '/api/auth/check',
  '/api/live',
  '/api/track',
  '/api/track-view',
  '/api/profile-click',
  '/api/salve',
  '/api/referral/register', // OAuth callback
  '/api/debug',
  '/api/streamer/:id/badges',
  '/api/webhook',
  '/api/auth/twitch',
  '/api/team-coins/daily-bonus'
];

// Middleware CSRF conditionnel
app.use((req, res, next) => {
  const isExempted = csrfExemptions.some(path => req.path.startsWith(path));
  if (isExempted) return next();
  return csrfProtection(req, res, next);
});

// Rendre le token CSRF dispo pour les vues ou JS
app.use((req, res, next) => {
  try {
    res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
  } catch {
    res.locals.csrfToken = null;
  }
  next();
});

console.log('🔒 Sécurité initialisée : CSRF + CSP + Rate Limiting');

// ========================================
// 🧩 MIDDLEWARE DE PARRAINAGE (capture ?ref=CODE)
// ========================================
app.use((req, res, next) => {
  const refCode = req.query.ref;
  
  if (refCode) {
    // Sauvegarder en session
    req.session.referralCode = refCode;
    console.log(`🎯 Code de parrainage détecté : ${refCode}`);

    // Rediriger vers la page de connexion Twitch (si sur l’index)
    if (req.path === '/' || req.path === '/index' || req.path === '/index.html') {
      return res.redirect('/auth/twitch'); // ou vers /login si tu veux forcer la connexion
    }
  }

  next();
});


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

    // Générer un code de parrainage pour ce streamer si inexistant
let myReferralCode = streamer.referral_code;
if (!myReferralCode) {
  myReferralCode = user.login.substring(0,4).toUpperCase() + '-' + String(Math.floor(Math.random()*10000)).padStart(4,'0');
  await db.query('UPDATE streamers SET referral_code=? WHERE id=?', [myReferralCode, streamer.id]);
}

// ✅ Gérer le parrainage si un code est présent en session
if (req.session.referralCode) {
  const referralCode = req.session.referralCode;

  // Vérifier que ce n’est pas son propre code
  if (referralCode !== myReferralCode) {
    const [rows] = await db.query('SELECT id FROM streamers WHERE referral_code=?', [referralCode]);
    if (rows.length) {
      const referrerId = rows[0].id;

      // Ajouter dans la table referrals si pas déjà existant
      await db.query(`
        INSERT IGNORE INTO referrals (referrer_id, referee_id, referral_code, signup_date, is_active)
        VALUES (?, ?, ?, NOW(), 0)
      `, [referrerId, streamer.id, referralCode]);

      await db.query(`
        INSERT IGNORE INTO streamer_levels (streamer_id, level, xp, total_xp)
        VALUES (?, 1, 0, 0)
      `, [streamer.id]);


      // Récompenser parrain et filleul
      await addTeamCoins(referrerId, 100, 'referral_signup', 'Ton filleul vient de s’inscrire !', {referee_id: streamer.id});

      await addTeamCoins(streamer.id, 25, 'referral_welcome', 'Bienvenue sur Stream Team !');
    }
  }

  // Supprimer le code de session pour éviter doublon
  delete req.session.referralCode;
}

    req.session.user = {
      id: streamer.id,
      twitch_id: user.id,
      login: user.login,
      display_name: user.display_name,
      profile_image_url: user.profile_image_url,
      created_at_site: streamer.created_at_site,
      is_admin: streamer.is_admin,
      referral_code: myReferralCode,
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
// 🏅 API : BADGES D’UN STREAMER (filtrage intelligent)
// ========================================
app.get('/api/streamer/:id/badges', async (req, res) => {
  try {
    const streamerId = req.params.id;

    // Vérifie que le streamer existe
    const [exists] = await db.query(`SELECT id FROM streamers WHERE twitch_id = ?`, [streamerId]);
    if (exists.length === 0) {
      return res.status(404).json({ success: false, error: 'Streamer introuvable' });
    }

    // Récupère tous ses badges
    const [badges] = await db.query(`
      SELECT badge_key, badge_name, badge_icon, earned_at
      FROM streamer_badges
      WHERE streamer_id = (SELECT id FROM streamers WHERE twitch_id = ?)
      ORDER BY earned_at DESC
    `, [streamerId]);

    if (badges.length === 0) {
      return res.json({ success: true, badges: [] });
    }

    // 🎯 Filtrage : si plusieurs badges "recruiter_*", ne garder que le plus haut rang
    const rankOrder = ['recruiter_bronze', 'recruiter_silver', 'recruiter_gold', 'recruiter_platinum', 'recruiter_legend'];
    const highestRecruiterBadge = badges.find(b => rankOrder.includes(b.badge_key))
      ? badges
          .filter(b => rankOrder.includes(b.badge_key))
          .sort((a, b) => rankOrder.indexOf(b.badge_key) - rankOrder.indexOf(a.badge_key))[0]
      : null;

    // 🎖️ Conserver les autres badges normaux (hors recruteur)
    const otherBadges = badges.filter(b => !rankOrder.includes(b.badge_key));

    // Résultat final : badge le plus haut + autres
    const finalBadges = highestRecruiterBadge
      ? [highestRecruiterBadge, ...otherBadges]
      : otherBadges;

    res.json({
      success: true,
      badges: finalBadges.map(b => ({
        badge_key: b.badge_key,
        badge_name: b.badge_name,
        badge_icon: b.badge_icon,
        earned_at: b.earned_at
      }))
    });

  } catch (err) {
    console.error('[GET /api/streamer/:id/badges]', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});
console.log('🏅 API Badges installée');

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

app.post('/api/salve', async (req, res) => {
  try {
    // 1. VÉRIFIER L'AUTHENTIFICATION
    if (!req.session || !req.session.user) {
      return res.status(401).json({ 
        error: 'Non authentifié',
        success: false 
      });
    }

    const senderId = req.session.user.id;
    const senderLogin = req.session.user.login;
    
    // 2. RÉCUPÉRER LE TARGET (compatibilité ancien/nouveau code)
    const { targetLogin, login } = req.body;
    const target = targetLogin || login;
    
    if (!target) {
      return res.status(400).json({ 
        error: 'targetLogin requis',
        success: false 
      });
    }

    // 3. VÉRIFIER QU'ON NE S'ENVOIE PAS UNE SALVE À SOI-MÊME
    if (senderLogin === target) {
      return res.status(400).json({ 
        error: 'Tu ne peux pas t\'envoyer une salve à toi-même !',
        success: false 
      });
    }

    const today = new Date().toISOString().split('T')[0];

    // 4. VÉRIFIER LE COOLDOWN (30 secondes)
    const [[lastSalve]] = await db.query(`
      SELECT created_at 
      FROM salves 
      WHERE sender_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [senderId]);

    if (lastSalve) {
      const timeSinceLastSalve = Date.now() - new Date(lastSalve.created_at).getTime();
      const cooldownMs = 30 * 1000; // 30 secondes

      if (timeSinceLastSalve < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastSalve) / 1000);
        return res.status(429).json({ 
          error: `Attends ${remainingSeconds}s avant d'envoyer une autre salve`,
          remainingSeconds,
          success: false
        });
      }
    }

    // 5. VÉRIFIER LA LIMITE QUOTIDIENNE (20 salves/jour)
    const [[dailyCount]] = await db.query(`
      SELECT COUNT(*) as count
      FROM salves
      WHERE sender_id = ?
      AND DATE(created_at) = CURDATE()
    `, [senderId]);

    const dailyLimit = 20;
    if (dailyCount.count >= dailyLimit) {
      return res.status(429).json({ 
        error: `Limite de ${dailyLimit} salves par jour atteinte`,
        success: false
      });
    }

    // 6. RÉCUPÉRER LE DESTINATAIRE
    const [[targetUser]] = await db.query(
      'SELECT id, display_name FROM streamers WHERE login = ?', 
      [target]
    );
    
    if (!targetUser) {
      return res.status(404).json({ 
        error: 'Streamer introuvable',
        success: false 
      });
    }

    const targetId = targetUser.id;

    // 7. ENREGISTRER LA SALVE
    await db.query(
      'INSERT INTO salves (sender_id, receiver_id, created_at) VALUES (?, ?, NOW())', 
      [senderId, targetId]
    );

    // 💎 AJOUTER TEAM COINS AU DESTINATAIRE (+5 TC)
try {
  await addTeamCoins(
    targetId,
    5,
    'salve_received',
    `Salve reçue de ${senderLogin}`,
    { sender_id: senderId, sender_login: senderLogin }
  );
} catch (tcErr) {
  console.error('[Salve] Erreur Team Coins:', tcErr);
  // Ne pas bloquer si erreur Team Coins
}

    // 8. METTRE À JOUR LES STATS
    await db.query(`
      INSERT INTO streamer_stats (streamer_id, date, salves_received)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE salves_received = salves_received + 1
    `, [targetId, today]);

    await db.query(`
      INSERT INTO streamer_stats (streamer_id, date, salves_sent)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE salves_sent = salves_sent + 1
    `, [senderId, today]);

    // 9. METTRE À JOUR LE COMPTEUR GLOBAL
    await db.query(
      'UPDATE streamers SET salves = salves + 1 WHERE id = ?',
      [targetId]
    );

    // 10. AJOUTER DANS LE FLUX D'ACTIVITÉS
    await db.query(`
      INSERT INTO activity_feed (streamer_id, actor_id, activity_type, activity_data)
      VALUES (?, ?, 'salve_received', JSON_OBJECT('from_login', ?))
    `, [targetId, senderId, senderLogin]);

    // 11. DONNER DE L'XP (+5 XP)
    await db.query(`
      INSERT INTO streamer_levels (streamer_id, xp, total_xp)
      VALUES (?, 5, 5)
      ON DUPLICATE KEY UPDATE 
        xp = xp + 5,
        total_xp = total_xp + 5
    `, [senderId]);

    // 12. VÉRIFIER SI LEVEL UP
    const [[senderLevel]] = await db.query(
      'SELECT level, xp FROM streamer_levels WHERE streamer_id = ?',
      [senderId]
    );

    let leveledUp = false;
    let newLevel = null;
    
    if (senderLevel) {
      const xpForNextLevel = calculateXPForLevel(senderLevel.level + 1);
      if (senderLevel.xp >= xpForNextLevel) {
        newLevel = senderLevel.level + 1;
        leveledUp = true;
        
        await db.query(`
          UPDATE streamer_levels 
          SET level = ?, xp = xp - ?
          WHERE streamer_id = ?
        `, [newLevel, xpForNextLevel, senderId]);

        // 💎 AJOUTER TEAM COINS POUR LEVEL UP
        try {
          const coinsReward = newLevel * 100; // 100 TC par niveau
          await addTeamCoins(
            senderId,
            coinsReward,
            'level_up',
            `Niveau ${newLevel} atteint !`,
            { level: newLevel }
          );
        } catch (tcErr) {
          console.error('[Level Up] Erreur Team Coins:', tcErr);
        }
      }
    }

    // 13. RÉCUPÉRER LE NOUVEAU COMPTEUR
    const [[newCount]] = await db.query(
      'SELECT salves FROM streamers WHERE id = ?',
      [targetId]
    );

    console.log(`[SALVE] ${senderLogin} → ${target} (${dailyCount.count + 1}/${dailyLimit} today)`);

    // 14. RÉPONSE COMPLÈTE
    res.json({
      success: true,
      message: `Salve envoyée à ${targetUser.display_name} ! 🔥`,
      data: {
        target: {
          login: target,
          displayName: targetUser.display_name,
          totalSalves: newCount.salves
        },
        sender: {
          xpGained: 5,
          leveledUp,
          newLevel
        },
        limits: {
          dailyUsed: dailyCount.count + 1,
          dailyLimit,
          cooldownSeconds: 30
        }
      }
    });

  } catch (err) {
    console.error('[SALVE ERROR]', err);
    res.status(500).json({ 
      error: 'Erreur serveur',
      success: false,
      details: err.message 
    });
  }
});

// GET /api/salve/cooldown - Vérifier l'état du cooldown
app.get('/api/salve/cooldown', async (req, res) => {
  if (!req.session?.user) {
    return res.json({
      success: true,
      data: {
        cooldownActive: false,
        remainingSeconds: 0,
        dailyUsed: 0,
        dailyLimit: 20,
        canSend: false // Non connecté = ne peut pas envoyer
      }
    });
  }

  try {
    const userId = req.session.user.id;

    const [[lastSalve]] = await db.query(`
      SELECT created_at 
      FROM salves 
      WHERE sender_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [userId]);

    let cooldownActive = false;
    let remainingSeconds = 0;

    if (lastSalve) {
      const timeSinceLastSalve = Date.now() - new Date(lastSalve.created_at).getTime();
      const cooldownMs = 30 * 1000;

      if (timeSinceLastSalve < cooldownMs) {
        cooldownActive = true;
        remainingSeconds = Math.ceil((cooldownMs - timeSinceLastSalve) / 1000);
      }
    }

    const [[dailyCount]] = await db.query(`
      SELECT COUNT(*) as count
      FROM salves
      WHERE sender_id = ?
      AND DATE(created_at) = CURDATE()
    `, [userId]);

    const dailyLimit = 20;

    res.json({
      success: true,
      data: {
        cooldownActive,
        remainingSeconds,
        dailyUsed: dailyCount.count,
        dailyLimit,
        canSend: !cooldownActive && dailyCount.count < dailyLimit
      }
    });

  } catch (error) {
    console.error('[COOLDOWN ERROR]', error);
    res.status(500).json({ 
      error: 'Erreur serveur',
      success: false 
    });
  }
});

// GET /api/salve/history - Historique des salves
app.get('/api/salve/history', async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  try {
    const userId = req.session.user.id;
    const { type = 'both', limit = 20 } = req.query;

    let historyData = {};

    if (type === 'both' || type === 'received') {
      const [received] = await db.query(`
        SELECT 
          s.id,
          s.created_at,
          sender.login as sender_login,
          sender.display_name as sender_name,
          sender.profile_image_url as sender_avatar
        FROM salves s
        INNER JOIN streamers sender ON s.sender_id = sender.id
        WHERE s.receiver_id = ?
        ORDER BY s.created_at DESC
        LIMIT ?
      `, [userId, parseInt(limit)]);

      historyData.received = received;
    }

    if (type === 'both' || type === 'sent') {
      const [sent] = await db.query(`
        SELECT 
          s.id,
          s.created_at,
          receiver.login as receiver_login,
          receiver.display_name as receiver_name,
          receiver.profile_image_url as receiver_avatar
        FROM salves s
        INNER JOIN streamers receiver ON s.receiver_id = receiver.id
        WHERE s.sender_id = ?
        ORDER BY s.created_at DESC
        LIMIT ?
      `, [userId, parseInt(limit)]);

      historyData.sent = sent;
    }

    const [[stats]] = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM salves WHERE receiver_id = ?) as total_received,
        (SELECT COUNT(*) FROM salves WHERE sender_id = ?) as total_sent,
        (SELECT COUNT(*) FROM salves WHERE receiver_id = ? AND DATE(created_at) = CURDATE()) as received_today,
        (SELECT COUNT(*) FROM salves WHERE sender_id = ? AND DATE(created_at) = CURDATE()) as sent_today
    `, [userId, userId, userId, userId]);

    historyData.stats = stats;

    res.json({
      success: true,
      data: historyData
    });

  } catch (error) {
    console.error('[HISTORY ERROR]', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

console.log('🔥 Système de salves amélioré installé');

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
// 💎 API TEAM COINS - À ajouter dans app.js
// ========================================

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Ajouter des Team Coins à un streamer
 * @param {number} streamerId - ID du streamer
 * @param {number} amount - Montant (positif = gain, négatif = dépense)
 * @param {string} source - Clé de la source (doit exister dans team_coins_sources)
 * @param {string} description - Description de la transaction
 * @param {object} metadata - Données supplémentaires (optionnel)
 * @returns {Promise<number>} Nouveau solde
 */
async function addTeamCoins(streamerId, amount, source, description = '', metadata = null) {
  try {
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    
    const [result] = await db.query(
      `CALL add_team_coins(?, ?, ?, ?, ?)`,
      [streamerId, amount, source, description, metadataJson]
    );

    if (!result[0] || !result[0][0]) {
      throw new Error('Impossible de récupérer le nouveau solde.');
    }
    
    return result[0][0].new_balance;
  } catch (err) {
    console.error('[addTeamCoins] Erreur:', err);
    throw err;
  }
}

// ========================================
// 🏅 FONCTION : ATTRIBUER UN BADGE À UN STREAMER
// ========================================
/**
 * Ajouter un badge à un streamer
 * @param {number} streamerId - ID du streamer
 * @param {string} badgeKey - Identifiant unique du badge
 * @param {string} badgeName - Nom affiché du badge
 * @param {string} icon - Emoji ou icône du badge (par défaut 🏅)
 * @returns {Promise<boolean>} - true si ajouté, false si déjà possédé
 */
async function addBadge(streamerId, badgeKey, badgeName, icon = '🏅') {
  try {
    // Vérifie si le badge existe déjà
    const [exists] = await db.query(`
      SELECT id FROM streamer_badges WHERE streamer_id = ? AND badge_key = ?
    `, [streamerId, badgeKey]);

    if (exists.length > 0) {
      console.log(`🔸 Le badge '${badgeName}' est déjà attribué au streamer ${streamerId}`);
      return false;
    }

    // Insère le badge
    await db.query(`
      INSERT INTO streamer_badges (streamer_id, badge_key, badge_name, badge_icon)
      VALUES (?, ?, ?, ?)
    `, [streamerId, badgeKey, badgeName, icon]);

    console.log(`🏆 Nouveau badge attribué : ${badgeName} → Streamer ID ${streamerId}`);
    return true;

  } catch (err) {
    console.error('[addBadge] Erreur:', err);
    return false;
  }
}


/**
 * Récupérer le solde actuel d'un streamer
 */
async function getTeamCoinsBalance(streamerId) {
  const [rows] = await db.query(
    `SELECT team_coins FROM streamer_levels WHERE streamer_id = ?`,
    [streamerId]
  );
  return rows[0]?.team_coins || 0;
}

// ========================================
// 🏦 ENDPOINT: RÉCUPÉRER LE SOLDE
// ========================================

/**
 * GET /api/team-coins/balance
 * Récupère le solde actuel du streamer connecté
 */
app.get('/api/team-coins/balance', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    
    const [rows] = await db.query(`
      SELECT 
        sl.team_coins,
        sl.level,
        sl.rank_name,
        s.display_name,
        s.profile_image_url
      FROM streamer_levels sl
      INNER JOIN streamers s ON sl.streamer_id = s.id
      WHERE sl.streamer_id = ?
    `, [streamerId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Streamer introuvable' });
    }
    
    res.json({
      success: true,
      data: {
        balance: rows[0].team_coins,
        level: rows[0].level,
        rank: rows[0].rank_name,
        displayName: rows[0].display_name,
        avatar: rows[0].profile_image_url
      }
    });
    
  } catch (err) {
    console.error('[GET /api/team-coins/balance]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 📜 ENDPOINT: HISTORIQUE DES TRANSACTIONS
// ========================================

/**
 * GET /api/team-coins/transactions?limit=20&offset=0
 * Récupère l'historique des transactions
 */
app.get('/api/team-coins/transactions', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    
    // Récupérer les transactions
    const [transactions] = await db.query(`
      SELECT 
        tct.id,
        tct.amount,
        tct.balance_after,
        tct.transaction_type,
        tct.source,
        tct.description,
        tct.metadata,
        tct.created_at,
        tcs.source_name,
        tcs.icon
      FROM team_coins_transactions tct
      LEFT JOIN team_coins_sources tcs ON tct.source = tcs.source_key
      WHERE tct.streamer_id = ?
      ORDER BY tct.created_at DESC
      LIMIT ? OFFSET ?
    `, [streamerId, limit, offset]);
    
    // Compter le total
    const [countRows] = await db.query(`
      SELECT COUNT(*) as total
      FROM team_coins_transactions
      WHERE streamer_id = ?
    `, [streamerId]);
    
    const total = countRows[0].total;
    
    res.json({
      success: true,
      data: {
        transactions: transactions.map(t => ({
          id: t.id,
          amount: t.amount,
          balanceAfter: t.balance_after,
          type: t.transaction_type,
          source: t.source,
          sourceName: t.source_name || t.source,
          icon: t.icon || '💎',
          description: t.description,
          metadata: t.metadata ? (typeof t.metadata === 'string' ? JSON.parse(t.metadata) : t.metadata) : null,
          date: t.created_at
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: (offset + limit) < total
        }
      }
    });
    
  } catch (err) {
    console.error('[GET /api/team-coins/transactions]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 📊 ENDPOINT: STATISTIQUES TEAM COINS
// ========================================

/**
 * GET /api/team-coins/stats
 * Statistiques globales sur les Team Coins du streamer
 */
app.get('/api/team-coins/stats', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    
    // Total gagné
    const [earnedRows] = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as total_earned
      FROM team_coins_transactions
      WHERE streamer_id = ? AND transaction_type = 'earn'
    `, [streamerId]);
    
    // Total dépensé
    const [spentRows] = await db.query(`
      SELECT COALESCE(SUM(ABS(amount)), 0) as total_spent
      FROM team_coins_transactions
      WHERE streamer_id = ? AND transaction_type = 'spend'
    `, [streamerId]);
    
    // Solde actuel
    const balance = await getTeamCoinsBalance(streamerId);
    
    // Top 3 sources de gains
    const [topSourcesRows] = await db.query(`
      SELECT 
        tct.source,
        tcs.source_name,
        tcs.icon,
        COUNT(*) as count,
        SUM(tct.amount) as total_amount
      FROM team_coins_transactions tct
      LEFT JOIN team_coins_sources tcs ON tct.source = tcs.source_key
      WHERE tct.streamer_id = ? AND tct.transaction_type = 'earn'
      GROUP BY tct.source, tcs.source_name, tcs.icon
      ORDER BY total_amount DESC
      LIMIT 3
    `, [streamerId]);
    
    // Gains des 7 derniers jours
    const [last7daysRows] = await db.query(`
      SELECT 
        DATE(created_at) as date,
        SUM(CASE WHEN transaction_type = 'earn' THEN amount ELSE 0 END) as earned,
        SUM(CASE WHEN transaction_type = 'spend' THEN ABS(amount) ELSE 0 END) as spent
      FROM team_coins_transactions
      WHERE streamer_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [streamerId]);
    
    res.json({
      success: true,
      data: {
        balance,
        totalEarned: earnedRows[0].total_earned,
        totalSpent: spentRows[0].total_spent,
        topSources: topSourcesRows.map(s => ({
          source: s.source,
          name: s.source_name || s.source,
          icon: s.icon || '💎',
          count: s.count,
          totalAmount: s.total_amount
        })),
        last7Days: last7daysRows.map(d => ({
          date: d.date,
          earned: d.earned,
          spent: d.spent,
          net: d.earned - d.spent
        }))
      }
    });
    
  } catch (err) {
    console.error('[GET /api/team-coins/stats]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 🏆 ENDPOINT: CLASSEMENT TEAM COINS
// ========================================

/**
 * GET /api/team-coins/leaderboard?limit=50
 * Classement des streamers par Team Coins
 */
app.get('/api/team-coins/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    const [rows] = await db.query(`
      SELECT 
        streamer_id,
        login,
        display_name,
        profile_image_url,
        team_coins,
        level,
        rank_name,
        ranking
      FROM v_team_coins_leaderboard
      LIMIT ?
    `, [limit]);
    
    res.json({
      success: true,
      data: rows.map(r => ({
        streamerId: r.streamer_id,
        login: r.login,
        displayName: r.display_name,
        avatar: r.profile_image_url,
        teamCoins: r.team_coins,
        level: r.level,
        rank: r.rank_name,
        position: r.ranking
      }))
    });
    
  } catch (err) {
    console.error('[GET /api/team-coins/leaderboard]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 💰 ENDPOINT: GAGNER DES TEAM COINS (ADMIN/SYSTÈME)
// ========================================

/**
 * POST /api/team-coins/earn
 * Faire gagner des Team Coins à un streamer
 * Body: { streamerId, source, amount?, description?, metadata? }
 */
app.post('/api/team-coins/earn', requireAuth, async (req, res) => {
  try {
    const { streamerId, source, amount, description, metadata } = req.body;
    
    // Vérifier que l'utilisateur gagne des coins pour lui-même
    // OU qu'il est admin (pour système automatique)
    if (streamerId !== req.session.user.id && !req.session.user.is_admin) {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    
    // Vérifier que la source existe
    const [sourceRows] = await db.query(`
      SELECT base_amount, source_name
      FROM team_coins_sources
      WHERE source_key = ? AND is_active = 1
    `, [source]);
    
    if (sourceRows.length === 0) {
      return res.status(400).json({ error: 'Source invalide' });
    }
    
    const baseAmount = sourceRows[0].base_amount;
    const sourceName = sourceRows[0].source_name;
    const finalAmount = amount || baseAmount;
    
    // Ajouter les Team Coins
    const newBalance = await addTeamCoins(
      streamerId,
      finalAmount,
      source,
      description || `Récompense: ${sourceName}`,
      metadata
    );
    
    res.json({
      success: true,
      data: {
        amount: finalAmount,
        newBalance,
        source,
        sourceName
      }
    });
    
  } catch (err) {
    console.error('[POST /api/team-coins/earn]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 🛒 ENDPOINT: DÉPENSER DES TEAM COINS
// ========================================

/**
 * POST /api/team-coins/spend
 * Dépenser des Team Coins
 * Body: { source, amount?, description?, metadata? }
 */
app.post('/api/team-coins/spend', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    const { source, amount, description, metadata } = req.body;
    
    // Vérifier le solde
    const currentBalance = await getTeamCoinsBalance(streamerId);
    
    // Récupérer le coût depuis la source
    const [sourceRows] = await db.query(`
      SELECT base_amount, source_name
      FROM team_coins_sources
      WHERE source_key = ? AND is_active = 1
    `, [source]);
    
    if (sourceRows.length === 0) {
      return res.status(400).json({ error: 'Source invalide' });
    }
    
    const cost = Math.abs(amount || sourceRows[0].base_amount);
    const sourceName = sourceRows[0].source_name;
    
    // Vérifier si assez de Team Coins
    if (currentBalance < cost) {
      return res.status(400).json({ 
        error: 'Solde insuffisant',
        required: cost,
        current: currentBalance
      });
    }
    
    // Dépenser les Team Coins (montant négatif)
    const newBalance = await addTeamCoins(
      streamerId,
      -cost,
      source,
      description || `Achat: ${sourceName}`,
      metadata
    );
    
    res.json({
      success: true,
      data: {
        spent: cost,
        newBalance,
        source,
        sourceName
      }
    });
    
  } catch (err) {
    console.error('[POST /api/team-coins/spend]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 🎁 ENDPOINT: BONUS QUOTIDIEN - VERSION SÉCURISÉE
// ========================================

/**
 * POST /api/team-coins/daily-bonus
 * Réclamer le bonus quotidien de connexion
 */
app.post('/api/team-coins/daily-bonus', requireAuth, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    const streamerId = req.session.user.id;
    
    // Démarrer une transaction pour éviter les doubles réclamations
    await connection.beginTransaction();
    
    // Verrouiller la ligne pour empêcher les accès concurrents
    const [lastLoginRows] = await connection.query(`
      SELECT 
        last_login_date,
        streak_days,
        DATE(last_login_date) = CURDATE() as already_claimed_today
      FROM streamer_levels
      WHERE streamer_id = ?
      FOR UPDATE
    `, [streamerId]);
    
    const alreadyClaimedToday = lastLoginRows[0]?.already_claimed_today === 1;
    const lastLoginDate = lastLoginRows[0]?.last_login_date;
    const currentStreakDays = lastLoginRows[0]?.streak_days || 0;
    
    // ✅ Vérifier si déjà réclamé aujourd'hui
    if (alreadyClaimedToday) {
      await connection.rollback();
      connection.release();
      
      return res.json({
        success: false,
        message: "🎁 Bonus déjà réclamé aujourd'hui",
        nextBonus: 'Reviens demain !',
        streakDays: currentStreakDays
      });
    }
    
    // Calculer la série de jours consécutifs
    let streakDays = currentStreakDays;
    
    // Vérifier si la dernière connexion était hier
    const [yesterdayCheck] = await connection.query(`
      SELECT 
        DATE(last_login_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) as was_yesterday
      FROM streamer_levels
      WHERE streamer_id = ?
    `, [streamerId]);
    
    const wasYesterday = yesterdayCheck[0]?.was_yesterday === 1;
    
    if (wasYesterday) {
      streakDays += 1; // Série continue
    } else if (lastLoginDate !== null) {
      streakDays = 1; // Réinitialiser la série
    } else {
      streakDays = 1; // Première connexion
    }
    
    // Mettre à jour la date et la série
    await connection.query(`
      UPDATE streamer_levels
      SET last_login_date = NOW(),
          streak_days = ?
      WHERE streamer_id = ?
    `, [streakDays, streamerId]);
    
    // Calculer le bonus selon la série
    let bonusAmount = 10; // Base
    let bonusSource = 'daily_login';
    let bonusDescription = 'Bonus de connexion quotidienne';
    
    if (streakDays >= 30) {
      bonusAmount = 510;
      bonusSource = 'streak_30days';
      bonusDescription = '🔥 Incroyable ! Série de 30 jours !';
    } else if (streakDays >= 7) {
      bonusAmount = 85;
      bonusSource = 'streak_7days';
      bonusDescription = '🔥 Super ! Série de 7 jours !';
    } else if (streakDays >= 3) {
      bonusAmount = 35;
      bonusSource = 'streak_3days';
      bonusDescription = '🔥 Bien joué ! Série de 3 jours !';
    }
    
    // Récupérer le solde actuel
    const [balanceRows] = await connection.query(`
      SELECT team_coins FROM streamer_levels WHERE streamer_id = ?
    `, [streamerId]);
    
    const currentBalance = balanceRows[0]?.team_coins || 0;
    const newBalance = currentBalance + bonusAmount;
    
    // Mettre à jour le solde
    await connection.query(`
      UPDATE streamer_levels
      SET team_coins = ?
      WHERE streamer_id = ?
    `, [newBalance, streamerId]);
    
    // Enregistrer la transaction
    await connection.query(`
      INSERT INTO team_coins_transactions (
        streamer_id,
        amount,
        balance_after,
        transaction_type,
        source,
        description,
        metadata
      ) VALUES (?, ?, ?, 'earn', ?, ?, ?)
    `, [
      streamerId,
      bonusAmount,
      newBalance,
      bonusSource,
      bonusDescription,
      JSON.stringify({ streak_days: streakDays })
    ]);
    
    // Valider la transaction
    await connection.commit();
    connection.release();
    
    // Réponse
    res.json({
      success: true,
      data: {
        bonus: bonusAmount,
        newBalance,
        streakDays,
        message: bonusDescription
      }
    });
    
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('[POST /api/team-coins/daily-bonus]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 📋 ENDPOINT: LISTE DES SOURCES
// ========================================

/**
 * GET /api/team-coins/sources?type=earn
 * Liste des sources de gains/dépenses disponibles
 */
app.get('/api/team-coins/sources', async (req, res) => {
  try {
    const type = req.query.type; // 'earn' ou 'spend'
    
    let query = `
      SELECT 
        source_key,
        source_name,
        base_amount,
        icon,
        description
      FROM team_coins_sources
      WHERE is_active = 1
    `;
    
    const params = [];
    
    if (type === 'earn') {
      query += ` AND base_amount > 0`;
    } else if (type === 'spend') {
      query += ` AND base_amount < 0`;
    }
    
    query += ` ORDER BY ABS(base_amount) DESC`;
    
    const [rows] = await db.query(query, params);
    
    res.json({
      success: true,
      data: rows.map(r => ({
        key: r.source_key,
        name: r.source_name,
        amount: r.base_amount,
        icon: r.icon,
        description: r.description
      }))
    });
    
  } catch (err) {
    console.error('[GET /api/team-coins/sources]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// EXPORTS DES FONCTIONS HELPER
// ========================================
// Si tu utilises des modules, exporte ces fonctions
// pour les utiliser ailleurs dans ton code

// module.exports = {
//   addTeamCoins,
//   getTeamCoinsBalance
// };

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
// 📊 DASHBOARD STREAMER - API ROUTES
// À ajouter dans app.js
// Adapté pour la table "streamers"
// ========================================

// ========================================
// MIDDLEWARE DE SÉCURITÉ
// ========================================

/**
 * Vérifie que l'utilisateur est connecté
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ 
      error: 'Non authentifié',
      message: 'Vous devez être connecté pour accéder au dashboard'
    });
  }
  next();
}

// ========================================
// 📊 DASHBOARD OVERVIEW
// ========================================

/**
 * GET /api/dashboard/overview
 * Vue d'ensemble du dashboard du streamer connecté
 */
app.get('/api/dashboard/overview', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;

    // 1. Infos streamer et niveau
    const [streamerLevelRows] = await db.query(`
      SELECT 
        s.login,
        s.display_name,
        s.profile_image_url,
        sl.level,
        sl.xp,
        sl.total_xp,
        sl.rank_name,
        sl.streak_days,
        sl.last_login_date
      FROM streamers s
      LEFT JOIN streamer_levels sl ON s.id = sl.streamer_id
      WHERE s.id = ?
    `, [streamerId]);

    if (streamerLevelRows.length === 0) {
      return res.status(404).json({ error: 'Streamer introuvable' });
    }

    const streamerLevel = streamerLevelRows[0];
    const xpForNextLevel = calculateXPForLevel(streamerLevel.level + 1);

    // 2. KPIs - Stats des 7 derniers jours
    const [kpisRows] = await db.query(`
      SELECT 
        COALESCE(SUM(profile_views), 0) as total_views,
        COALESCE(SUM(salves_received), 0) as total_salves,
        COALESCE(SUM(clips_saved), 0) as total_clips
      FROM streamer_stats
      WHERE streamer_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `, [streamerId]);

    // Stats période précédente
    const [previousKpisRows] = await db.query(`
      SELECT 
        COALESCE(SUM(profile_views), 0) as total_views,
        COALESCE(SUM(salves_received), 0) as total_salves
      FROM streamer_stats
      WHERE streamer_id = ? 
      AND date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      AND date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `, [streamerId]);

    const kpis = kpisRows[0];
    const previousKpis = previousKpisRows[0];
    const viewsEvolution = calculateEvolution(kpis.total_views, previousKpis.total_views);
    const salvesEvolution = calculateEvolution(kpis.total_salves, previousKpis.total_salves);

    // 3. Filleuls actifs
    const [referralsRows] = await db.query(`
      SELECT 
        COUNT(*) as total_referrals,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_referrals
      FROM referrals
      WHERE referrer_id = ?
    `, [streamerId]);

    const referrals = referralsRows[0];

    // 4. Classement global
    const [rankingRows] = await db.query(`
      SELECT ranking 
      FROM v_global_ranking 
      WHERE streamer_id = ?
    `, [streamerId]);

    const ranking = rankingRows[0]?.ranking || null;

    // 5. Graphique des vues (7 derniers jours)
    const [viewsChartRows] = await db.query(`
      SELECT 
        date,
        profile_views
      FROM streamer_stats
      WHERE streamer_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      ORDER BY date ASC
    `, [streamerId]);

    // 6. Sources de trafic
    const [sourcesRows] = await db.query(`
      SELECT 
        source,
        SUM(visits) as total_visits
      FROM traffic_sources
      WHERE streamer_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY source
      ORDER BY total_visits DESC
    `, [streamerId]);

    // 7. Activité récente
    const [activityRows] = await db.query(`
      SELECT 
        af.id,
        af.activity_type,
        af.activity_data,
        af.created_at,
        s.login as actor_login,
        s.display_name as actor_name,
        s.profile_image_url as actor_avatar
      FROM activity_feed af
      LEFT JOIN streamers s ON af.actor_id = s.id
      WHERE af.streamer_id = ?
      ORDER BY af.created_at DESC
      LIMIT 10
    `, [streamerId]);

    // 🔹 Sécurisation du JSON.parse()
    const safeParsedActivity = activityRows.map(row => {
      let parsedData = {};
      try {
        parsedData = typeof row.activity_data === 'string'
          ? JSON.parse(row.activity_data)
          : (row.activity_data || {});
      } catch {
        parsedData = {};
      }

      return {
        id: row.id,
        type: row.activity_type,
        data: parsedData,
        actor: row.actor_login ? {
          login: row.actor_login,
          name: row.actor_name,
          avatar: row.actor_avatar
        } : null,
        timestamp: row.created_at,
        timeAgo: getTimeAgo(row.created_at)
      };
    });

    // 8. Quêtes actives
    const [questsRows] = await db.query(`
      SELECT 
        q.id,
        q.quest_type,
        q.title,
        q.description,
        q.objective_count,
        q.xp_reward,
        q.additional_reward,
        q.difficulty,
        sq.progression,
        sq.completed,
        sq.expires_at
      FROM streamer_quests sq
      INNER JOIN quests q ON sq.quest_id = q.id
      WHERE sq.streamer_id = ? 
      AND sq.completed = 0
      AND (sq.expires_at IS NULL OR sq.expires_at > NOW())
      ORDER BY 
        FIELD(q.quest_type, 'daily', 'weekly', 'special'),
        q.id
      LIMIT 5
    `, [streamerId]);

    // Réponse
    res.json({
      success: true,
      data: {
        profile: {
          login: streamerLevel.login,
          displayName: streamerLevel.display_name,
          avatar: streamerLevel.profile_image_url,
          level: streamerLevel.level || 1,
          xp: streamerLevel.xp || 0,
          xpForNextLevel,
          totalXp: streamerLevel.total_xp || 0,
          rank: streamerLevel.rank_name || 'Recrue',
          streak: streamerLevel.streak_days || 0
        },
        kpis: {
          views: {
            value: kpis.total_views,
            evolution: viewsEvolution,
            trend: viewsEvolution >= 0 ? 'up' : 'down'
          },
          salves: {
            value: kpis.total_salves,
            evolution: salvesEvolution,
            trend: salvesEvolution >= 0 ? 'up' : 'down'
          },
          referrals: {
            total: referrals.total_referrals || 0,
            active: referrals.active_referrals || 0,
            percentage: referrals.total_referrals > 0 
              ? Math.round((referrals.active_referrals / referrals.total_referrals) * 100) 
              : 0
          },
          ranking: {
            position: ranking,
            trend: 'stable'
          }
        },
        charts: {
          views: viewsChartRows.map(row => ({
            date: row.date,
            value: row.profile_views
          })),
          sources: sourcesRows.map(row => ({
            source: row.source,
            value: row.total_visits
          }))
        },
        recentActivity: safeParsedActivity,
        quests: {
          daily: questsRows.filter(q => q.quest_type === 'daily').map(formatQuest),
          weekly: questsRows.filter(q => q.quest_type === 'weekly').map(formatQuest),
          special: questsRows.filter(q => q.quest_type === 'special').map(formatQuest)
        }
      }
    });

  } catch (err) {
    console.error('[API /dashboard/overview]', err);
    res.status(500).json({ 
      error: 'Erreur serveur',
      message: 'Impossible de charger le dashboard'
    });
  }
});


// ========================================
// 📈 GRAPHIQUES DÉTAILLÉS
// ========================================

/**
 * GET /api/dashboard/charts/views?period=7d
 * Graphique détaillé des vues
 */
app.get('/api/dashboard/charts/views', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    const period = req.query.period || '7d';
    
    const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
    
    const [rows] = await db.query(`
      SELECT 
        date,
        profile_views,
        profile_views_unique,
        salves_received,
        clips_saved
      FROM streamer_stats
      WHERE streamer_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY date ASC
    `, [streamerId, days]);
    
    res.json({
      success: true,
      data: rows.map(row => ({
        date: row.date,
        views: row.profile_views,
        uniqueViews: row.profile_views_unique,
        salves: row.salves_received,
        clips: row.clips_saved
      }))
    });
    
  } catch (err) {
    console.error('[API /dashboard/charts/views]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 🔔 ACTIVITÉ RÉCENTE
// ========================================

/**
 * GET /api/dashboard/activity?limit=20
 * Feed d'activité récente
 */
app.get('/api/dashboard/activity', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    
    const [rows] = await db.query(`
      SELECT 
        af.id,
        af.activity_type,
        af.activity_data,
        af.created_at,
        s.login as actor_login,
        s.display_name as actor_name,
        s.profile_image_url as actor_avatar
      FROM activity_feed af
      LEFT JOIN streamers s ON af.actor_id = s.id
      WHERE af.streamer_id = ?
      ORDER BY af.created_at DESC
      LIMIT ?
    `, [streamerId, limit]);
    
    res.json({
      success: true,
      data: rows.map(row => {
        let parsedData = {};
        try {
          parsedData = typeof row.activity_data === 'string'
            ? JSON.parse(row.activity_data)
            : (row.activity_data || {});
        } catch {
          parsedData = {};
        }

        return {
          id: row.id,
          type: row.activity_type,
          data: parsedData,
          actor: row.actor_login ? {
            login: row.actor_login,
            name: row.actor_name,
            avatar: row.actor_avatar
          } : null,
          timestamp: row.created_at,
          timeAgo: getTimeAgo(row.created_at)
        };
      })
    });
    
  } catch (err) {
    console.error('[API /dashboard/activity]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// FONCTIONS UTILITAIRES
// ========================================
/**
 * Calcule l'XP nécessaire pour atteindre un niveau
 */
function calculateXPForLevel(level) {
  // Formule : 100 * level^1.5
  return Math.floor(100 * Math.pow(level, 1.5));
}
/**
 * Calcule l'évolution en %
 */
function calculateEvolution(current, previous) {
  // Sécurité : si previous est null, undefined ou NaN
  if (!previous || isNaN(previous)) {
    return current > 0 ? 100 : 0;
  }

  if (previous === 0) return current > 0 ? 100 : 0;

  const evolution = ((current - previous) / previous) * 100;
  return Math.round(evolution);
}
/**
 * Formate une quête pour l'API
 */
function formatQuest(quest) {
  const timeLeft = quest.expires_at ? getTimeLeft(quest.expires_at) : null;
  
  return {
    id: quest.id,
    type: quest.quest_type,
    title: quest.title,
    description: quest.description,
    progression: quest.progression || 0,
    total: quest.objective_count,
    completed: quest.completed === 1,
    reward: {
      xp: quest.xp_reward,
      additional: quest.additional_reward
    },
    difficulty: quest.difficulty,
    expiresAt: quest.expires_at,
    timeLeft: timeLeft
  };
}
/**
 * Calcule le temps écoulé (ex: "Il y a 5 min")
 */
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  
  if (seconds < 60) return 'À l\'instant';
  if (seconds < 3600) return `Il y a ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Il y a ${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `Il y a ${Math.floor(seconds / 86400)}j`;
  return new Date(date).toLocaleDateString('fr-FR');
}
/**
 * Calcule le temps restant (ex: "8h 32min")
 */
function getTimeLeft(expiresAt) {
  const seconds = Math.floor((new Date(expiresAt) - new Date()) / 1000);
  
  if (seconds <= 0) return 'Expiré';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
  return `${Math.floor(seconds / 86400)}j ${Math.floor((seconds % 86400) / 3600)}h`;
}

console.log('✅ Dashboard API routes loaded (table: streamers)');

// ========================================
// 📊 HELPER: Obtenir les stats d'un streamer
// ========================================
async function getStreamerStats(streamerId, days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const [stats] = await db.query(`
      SELECT 
        DATE_FORMAT(date, '%Y-%m-%d') as date,
        SUM(profile_views) as views,
        SUM(profile_views_unique) as unique_views,
        SUM(salves_received) as salves,
        SUM(clips_saved) as clips
      FROM streamer_stats
      WHERE streamer_id = ?
      AND date >= ?
      GROUP BY date
      ORDER BY date ASC
    `, [streamerId, startDateStr]);

    return stats;
  } catch (error) {
    console.error('[GET STATS ERROR]', error);
    return [];
  }
}

module.exports = { getStreamerStats };

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
// 📊 SYSTÈME DE TRACKING - Stream Team HQ
// À COPIER-COLLER dans app.js AVANT app.listen()
// ========================================

/**
 * API: Tracker une vue de profil
 * POST /api/track-view
 */
app.post('/api/track-view', async (req, res) => {
  try {
    const { streamer_login, referrer } = req.body;
    
    if (!streamer_login) {
      return res.status(400).json({ error: 'streamer_login requis' });
    }

    // Récupérer l'ID du streamer visité
    const [[streamer]] = await db.query(
      'SELECT id FROM streamers WHERE login = ?',
      [streamer_login]
    );

    if (!streamer) {
      return res.status(404).json({ error: 'Streamer introuvable' });
    }

    const streamerId = streamer.id;
    const today = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
    const visitorId = req.session?.user?.id || null;

    // 1. Déterminer la source de trafic
    let source = 'direct';
    if (referrer) {
      if (referrer.includes('google')) source = 'google';
      else if (referrer.includes('twitch.tv')) source = 'twitch';
      else if (referrer.includes('twitter.com') || referrer.includes('x.com')) source = 'twitter';
      else if (referrer.includes('discord')) source = 'discord';
      else if (referrer.includes('stream-team.site')) source = 'internal';
      else source = 'other';
    }

    // 2. Mettre à jour les stats quotidiennes (profile_views)
    await db.query(`
      INSERT INTO streamer_stats (streamer_id, date, profile_views, profile_views_unique)
      VALUES (?, ?, 1, 1)
      ON DUPLICATE KEY UPDATE 
        profile_views = profile_views + 1
    `, [streamerId, today]);

    // 3. Mettre à jour le compteur unique si c'est un nouvel utilisateur aujourd'hui
    if (visitorId) {
      // Vérifier si c'est la première visite de ce user aujourd'hui
      const [[existingView]] = await db.query(`
        SELECT id FROM activity_feed 
        WHERE streamer_id = ? 
        AND actor_id = ? 
        AND activity_type = 'profile_view'
        AND DATE(created_at) = ?
      `, [streamerId, visitorId, today]);

      if (!existingView) {
        // C'est une nouvelle vue unique aujourd'hui
        await db.query(`
          UPDATE streamer_stats 
          SET profile_views_unique = profile_views_unique + 1
          WHERE streamer_id = ? AND date = ?
        `, [streamerId, today]);
      }
    }

    // 4. Enregistrer la source de trafic
    await db.query(`
      INSERT INTO traffic_sources (streamer_id, date, source, visits)
      VALUES (?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE visits = visits + 1
    `, [streamerId, today, source]);

    // 5. Ajouter dans le flux d'activité
    await db.query(`
      INSERT INTO activity_feed (streamer_id, actor_id, activity_type, activity_data)
      VALUES (?, ?, 'profile_view', JSON_OBJECT('source', ?, 'referrer', ?))
    `, [streamerId, visitorId, source, referrer || null]);

    // 6. Mettre à jour le compteur global (ancienne table)
    await db.query(
      'UPDATE streamers SET clicks = clicks + 1 WHERE id = ?',
      [streamerId]
    );

    console.log(`[TRACKING] Vue enregistrée: ${streamer_login} (source: ${source})`);

    res.json({ 
      success: true, 
      message: 'Vue enregistrée',
      source 
    });

  } catch (error) {
    console.error('[TRACKING ERROR]', error);
    res.status(500).json({ 
      error: 'Erreur lors du tracking',
      details: error.message 
    });
  }
});


/**
 * API: Tracker une salve envoyée
 * POST /api/track-salve
 */
app.post('/api/track-salve', async (req, res) => {
  try {
    const { from_login, to_login } = req.body;

    if (!from_login || !to_login) {
      return res.status(400).json({ error: 'from_login et to_login requis' });
    }

    // Vérifier que l'utilisateur est connecté et correspond à from_login
    if (!req.session?.user || req.session.user.login !== from_login) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    const [[fromStreamer]] = await db.query(
      'SELECT id FROM streamers WHERE login = ?',
      [from_login]
    );

    const [[toStreamer]] = await db.query(
      'SELECT id FROM streamers WHERE login = ?',
      [to_login]
    );

    if (!fromStreamer || !toStreamer) {
      return res.status(404).json({ error: 'Streamer introuvable' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Mettre à jour les stats du destinataire (salves_received)
    await db.query(`
      INSERT INTO streamer_stats (streamer_id, date, salves_received)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE salves_received = salves_received + 1
    `, [toStreamer.id, today]);

    // Mettre à jour les stats de l'envoyeur (salves_sent)
    await db.query(`
      INSERT INTO streamer_stats (streamer_id, date, salves_sent)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE salves_sent = salves_sent + 1
    `, [fromStreamer.id, today]);

    // Ajouter dans activity_feed
    await db.query(`
      INSERT INTO activity_feed (streamer_id, actor_id, activity_type, activity_data)
      VALUES (?, ?, 'salve_received', JSON_OBJECT('from_login', ?))
    `, [toStreamer.id, fromStreamer.id, from_login]);

    // Mettre à jour l'ancien compteur
    await db.query(
      'UPDATE streamers SET salves = salves + 1 WHERE id = ?',
      [toStreamer.id]
    );

    console.log(`[TRACKING] Salve: ${from_login} → ${to_login}`);

    res.json({ success: true, message: 'Salve enregistrée' });

  } catch (error) {
    console.error('[TRACKING SALVE ERROR]', error);
    res.status(500).json({ 
      error: 'Erreur lors du tracking de la salve',
      details: error.message 
    });
  }
});


/**
 * API: Tracker un clip sauvegardé
 * POST /api/track-clip-save
 */
app.post('/api/track-clip-save', async (req, res) => {
  try {
    const { streamer_login, clip_id } = req.body;

    if (!streamer_login || !clip_id) {
      return res.status(400).json({ error: 'streamer_login et clip_id requis' });
    }

    const [[streamer]] = await db.query(
      'SELECT id FROM streamers WHERE login = ?',
      [streamer_login]
    );

    if (!streamer) {
      return res.status(404).json({ error: 'Streamer introuvable' });
    }

    const today = new Date().toISOString().split('T')[0];
    const userId = req.session?.user?.id || null;

    // Mettre à jour les stats (clips_saved)
    await db.query(`
      INSERT INTO streamer_stats (streamer_id, date, clips_saved)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE clips_saved = clips_saved + 1
    `, [streamer.id, today]);

    // Ajouter dans activity_feed
    await db.query(`
      INSERT INTO activity_feed (streamer_id, actor_id, activity_type, activity_data)
      VALUES (?, ?, 'clip_saved', JSON_OBJECT('clip_id', ?))
    `, [streamer.id, userId, clip_id]);

    console.log(`[TRACKING] Clip sauvegardé: ${clip_id} (${streamer_login})`);

    res.json({ success: true, message: 'Clip tracking enregistré' });

  } catch (error) {
    console.error('[TRACKING CLIP ERROR]', error);
    res.status(500).json({ 
      error: 'Erreur lors du tracking du clip',
      details: error.message 
    });
  }
});

console.log('📊 Routes de tracking installées');

// ========================================
// 🔥 SYSTÈME DE SALVES COMPLET - BACKEND
// À ajouter dans app.js (après les routes de tracking)
// ========================================

/**
 * POST /api/salve/send
 * Envoyer une salve à un streamer
 * Avec cooldown, limites quotidiennes, et vérifications
 */
app.post('/api/salve/send', requireAuth, async (req, res) => {
  try {
    const { targetLogin } = req.body;
    const senderId = req.session.user.id;
    const senderLogin = req.session.user.login;

    if (!targetLogin) {
      return res.status(400).json({ error: 'targetLogin requis' });
    }

    // Vérifier qu'on ne s'envoie pas une salve à soi-même
    if (senderLogin === targetLogin) {
      return res.status(400).json({ error: 'Tu ne peux pas t\'envoyer une salve à toi-même !' });
    }

    // Récupérer le destinataire
    const [[target]] = await db.query(
      'SELECT id, display_name FROM streamers WHERE login = ?',
      [targetLogin]
    );

    if (!target) {
      return res.status(404).json({ error: 'Streamer introuvable' });
    }

    const targetId = target.id;
    const today = new Date().toISOString().split('T')[0];

    // 1. VÉRIFIER LE COOLDOWN (30 secondes entre chaque salve)
    const [[lastSalve]] = await db.query(`
      SELECT created_at 
      FROM salves 
      WHERE sender_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [senderId]);

    if (lastSalve) {
      const timeSinceLastSalve = Date.now() - new Date(lastSalve.created_at).getTime();
      const cooldownMs = 30 * 1000; // 30 secondes

      if (timeSinceLastSalve < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastSalve) / 1000);
        return res.status(429).json({ 
          error: 'Cooldown actif',
          message: `Attends ${remainingSeconds}s avant d'envoyer une autre salve`,
          remainingSeconds
        });
      }
    }

    // 2. VÉRIFIER LA LIMITE QUOTIDIENNE (20 salves/jour)
    const [[dailyCount]] = await db.query(`
      SELECT COUNT(*) as count
      FROM salves
      WHERE sender_id = ?
      AND DATE(created_at) = CURDATE()
    `, [senderId]);

    const dailyLimit = 20;
    if (dailyCount.count >= dailyLimit) {
      return res.status(429).json({ 
        error: 'Limite quotidienne atteinte',
        message: `Tu as atteint la limite de ${dailyLimit} salves par jour`,
        limit: dailyLimit
      });
    }

    // 3. ENREGISTRER LA SALVE
    await db.query(`
      INSERT INTO salves (sender_id, receiver_id, created_at)
      VALUES (?, ?, NOW())
    `, [senderId, targetId]);

    // 4. METTRE À JOUR LES STATS
    // Stats du destinataire (salves_received)
    await db.query(`
      INSERT INTO streamer_stats (streamer_id, date, salves_received)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE salves_received = salves_received + 1
    `, [targetId, today]);

    // Stats de l'envoyeur (salves_sent)
    await db.query(`
      INSERT INTO streamer_stats (streamer_id, date, salves_sent)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE salves_sent = salves_sent + 1
    `, [senderId, today]);

    // 5. METTRE À JOUR LE COMPTEUR GLOBAL
    await db.query(
      'UPDATE streamers SET salves = salves + 1 WHERE id = ?',
      [targetId]
    );

    // 6. AJOUTER DANS LE FLUX D'ACTIVITÉS
    await db.query(`
      INSERT INTO activity_feed (streamer_id, actor_id, activity_type, activity_data)
      VALUES (?, ?, 'salve_received', JSON_OBJECT('from_login', ?))
    `, [targetId, senderId, senderLogin]);

    // 7. DONNER DE L'XP À L'ENVOYEUR (+5 XP par salve envoyée)
    await db.query(`
      INSERT INTO streamer_levels (streamer_id, xp, total_xp)
      VALUES (?, 5, 5)
      ON DUPLICATE KEY UPDATE 
        xp = xp + 5,
        total_xp = total_xp + 5
    `, [senderId]);

    // Vérifier si l'envoyeur a progressé de niveau
    const [[senderLevel]] = await db.query(
      'SELECT level, xp FROM streamer_levels WHERE streamer_id = ?',
      [senderId]
    );

    let leveledUp = false;
    let newLevel = senderLevel.level;
    
    if (senderLevel) {
      const xpForNextLevel = calculateXPForLevel(senderLevel.level + 1);
      if (senderLevel.xp >= xpForNextLevel) {
        newLevel = senderLevel.level + 1;
        leveledUp = true;
        
        // Mettre à jour le niveau
        await db.query(`
          UPDATE streamer_levels 
          SET level = ?, xp = xp - ?
          WHERE streamer_id = ?
        `, [newLevel, xpForNextLevel, senderId]);
      }
    }

    // 8. RÉCUPÉRER LE NOUVEAU COMPTEUR DE SALVES
    const [[newCount]] = await db.query(
      'SELECT salves FROM streamers WHERE id = ?',
      [targetId]
    );

    console.log(`[SALVE] ${senderLogin} → ${targetLogin} (${dailyCount.count + 1}/${dailyLimit} today)`);

    // 9. RÉPONSE AVEC TOUTES LES INFOS
    res.json({
      success: true,
      message: `Salve envoyée à ${target.display_name} ! 🔥`,
      data: {
        target: {
          login: targetLogin,
          displayName: target.display_name,
          totalSalves: newCount.salves
        },
        sender: {
          xpGained: 5,
          leveledUp,
          newLevel: leveledUp ? newLevel : null
        },
        limits: {
          dailyUsed: dailyCount.count + 1,
          dailyLimit,
          cooldownSeconds: 30
        }
      }
    });

  } catch (error) {
    console.error('[SALVE ERROR]', error);
    res.status(500).json({ 
      error: 'Erreur lors de l\'envoi de la salve',
      details: error.message 
    });
  }
});


/**
 * GET /api/salve/history
 * Récupérer l'historique des salves (envoyées et reçues)
 */
app.get('/api/salve/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { type = 'both', limit = 20 } = req.query;

    let historyData = {};

    // Salves reçues
    if (type === 'both' || type === 'received') {
      const [received] = await db.query(`
        SELECT 
          s.id,
          s.created_at,
          sender.login as sender_login,
          sender.display_name as sender_name,
          sender.profile_image_url as sender_avatar
        FROM salves s
        INNER JOIN streamers sender ON s.sender_id = sender.id
        WHERE s.receiver_id = ?
        ORDER BY s.created_at DESC
        LIMIT ?
      `, [userId, parseInt(limit)]);

      historyData.received = received;
    }

    // Salves envoyées
    if (type === 'both' || type === 'sent') {
      const [sent] = await db.query(`
        SELECT 
          s.id,
          s.created_at,
          receiver.login as receiver_login,
          receiver.display_name as receiver_name,
          receiver.profile_image_url as receiver_avatar
        FROM salves s
        INNER JOIN streamers receiver ON s.receiver_id = receiver.id
        WHERE s.sender_id = ?
        ORDER BY s.created_at DESC
        LIMIT ?
      `, [userId, parseInt(limit)]);

      historyData.sent = sent;
    }

    // Stats globales
    const [[stats]] = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM salves WHERE receiver_id = ?) as total_received,
        (SELECT COUNT(*) FROM salves WHERE sender_id = ?) as total_sent,
        (SELECT COUNT(*) FROM salves WHERE receiver_id = ? AND DATE(created_at) = CURDATE()) as received_today,
        (SELECT COUNT(*) FROM salves WHERE sender_id = ? AND DATE(created_at) = CURDATE()) as sent_today
    `, [userId, userId, userId, userId]);

    historyData.stats = stats;

    res.json({
      success: true,
      data: historyData
    });

  } catch (error) {
    console.error('[SALVE HISTORY ERROR]', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération de l\'historique',
      details: error.message 
    });
  }
});


/**
 * GET /api/salve/cooldown
 * Vérifier si le cooldown est actif
 */
app.get('/api/salve/cooldown', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [[lastSalve]] = await db.query(`
      SELECT created_at 
      FROM salves 
      WHERE sender_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `, [userId]);

    let cooldownActive = false;
    let remainingSeconds = 0;

    if (lastSalve) {
      const timeSinceLastSalve = Date.now() - new Date(lastSalve.created_at).getTime();
      const cooldownMs = 30 * 1000; // 30 secondes

      if (timeSinceLastSalve < cooldownMs) {
        cooldownActive = true;
        remainingSeconds = Math.ceil((cooldownMs - timeSinceLastSalve) / 1000);
      }
    }

    // Compteur quotidien
    const [[dailyCount]] = await db.query(`
      SELECT COUNT(*) as count
      FROM salves
      WHERE sender_id = ?
      AND DATE(created_at) = CURDATE()
    `, [userId]);

    const dailyLimit = 20;

    res.json({
      success: true,
      data: {
        cooldownActive,
        remainingSeconds,
        dailyUsed: dailyCount.count,
        dailyLimit,
        dailyRemaining: dailyLimit - dailyCount.count,
        canSend: !cooldownActive && dailyCount.count < dailyLimit
      }
    });

  } catch (error) {
    console.error('[COOLDOWN CHECK ERROR]', error);
    res.status(500).json({ 
      error: 'Erreur lors de la vérification du cooldown',
      details: error.message 
    });
  }
});


/**
 * GET /api/salve/top-receivers
 * Top 10 des streamers qui ont reçu le plus de salves
 */
app.get('/api/salve/top-receivers', async (req, res) => {
  try {
    const { period = 'all', limit = 10 } = req.query;

    let dateFilter = '';
    if (period === 'today') {
      dateFilter = 'AND DATE(s.created_at) = CURDATE()';
    } else if (period === 'week') {
      dateFilter = 'AND s.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
    } else if (period === 'month') {
      dateFilter = 'AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }

    const [topReceivers] = await db.query(`
      SELECT 
        st.id,
        st.login,
        st.display_name,
        st.profile_image_url,
        COUNT(s.id) as salves_received,
        MAX(s.created_at) as last_salve_at
      FROM streamers st
      INNER JOIN salves s ON st.id = s.receiver_id
      WHERE 1=1 ${dateFilter}
      GROUP BY st.id
      ORDER BY salves_received DESC
      LIMIT ?
    `, [parseInt(limit)]);

    res.json({
      success: true,
      period,
      data: topReceivers
    });

  } catch (error) {
    console.error('[TOP RECEIVERS ERROR]', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération du top',
      details: error.message 
    });
  }
});

console.log('🔥 Routes de salves installées');

// ========================================
// 👥 API SYSTÈME DE PARRAINAGE
// À ajouter dans app.js après les endpoints Team Coins
// ========================================

// ========================================
// 1. RÉCUPÉRER SON CODE DE PARRAINAGE
// ========================================

/**
 * GET /api/referral/my-code
 * Récupère le code de parrainage du streamer connecté
 */
app.get('/api/referral/my-code', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    
    const [rows] = await db.query(`
      SELECT 
        referral_code,
        display_name,
        login
      FROM streamers
      WHERE id = ?
    `, [streamerId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Streamer introuvable' });
    }
    
    const code = rows[0].referral_code;
    const baseUrl = process.env.BASE_URL || 'https://stream-team.site';
    
    res.json({
      success: true,
      data: {
        code: code,
        shortLink: `${baseUrl}?ref=${code}`,
        fullLink: `${baseUrl}/home?ref=${code}`,
        qrCodeUrl: `/api/referral/qr-code/${code}`,
        displayName: rows[0].display_name,
        login: rows[0].login
      }
    });
    
  } catch (err) {
    console.error('[GET /api/referral/my-code]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 2. STATISTIQUES DE PARRAINAGE
// ========================================

/**
 * GET /api/referral/stats
 * Récupère les statistiques de parrainage du streamer
 */
app.get('/api/referral/stats', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    
    // Stats de base
    const [stats] = await db.query(`
      SELECT * FROM v_referral_stats
      WHERE streamer_id = ?
    `, [streamerId]);
    
    const referralStats = stats[0] || {
      total_referrals: 0,
      active_referrals: 0,
      referrals_last_7days: 0
    };
    
    // Calculer le prochain palier
    const milestones = [5, 10, 25, 50, 100];
    let nextMilestone = null;
    
    for (const milestone of milestones) {
      if (referralStats.total_referrals < milestone) {
        nextMilestone = {
          goal: milestone,
          current: referralStats.total_referrals,
          remaining: milestone - referralStats.total_referrals,
          reward: milestone === 5 ? '250 TC + Badge Bronze' :
                  milestone === 10 ? '500 TC + Badge Argent' :
                  milestone === 25 ? '1500 TC + Badge Or' :
                  milestone === 50 ? '3000 TC + Badge Platine' :
                  '10000 TC + Badge Légende'
        };
        break;
      }
    }
    
    // Classement
    const [ranking] = await db.query(`
      SELECT ranking FROM v_referral_leaderboard
      WHERE streamer_id = ?
    `, [streamerId]);
    
    // Total de Team Coins gagnés via parrainage
    const [coinsEarned] = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as total_coins
      FROM team_coins_transactions
      WHERE streamer_id = ?
      AND source LIKE 'referral%'
    `, [streamerId]);
    
    res.json({
      success: true,
      data: {
        totalReferrals: referralStats.total_referrals,
        activeReferrals: referralStats.active_referrals,
        referralsLast7Days: referralStats.referrals_last_7days,
        totalCoinsEarned: coinsEarned[0].total_coins,
        ranking: ranking[0]?.ranking || null,
        nextMilestone
      }
    });
    
  } catch (err) {
    console.error('[GET /api/referral/stats]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 3. LISTE DES FILLEULS
// ========================================

/**
 * GET /api/referral/referrals?limit=20&offset=0
 * Liste des filleuls du streamer
 */
app.get('/api/referral/referrals', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    
    const [referrals] = await db.query(`
      SELECT 
        r.id,
        r.signup_date,
        r.is_active,
        r.last_activity,
        s.id as referee_id,
        s.login as referee_login,
        s.display_name as referee_name,
        s.profile_image_url as referee_avatar,
        sl.level as referee_level,
        sl.team_coins as referee_coins,
        TIMESTAMPDIFF(DAY, r.last_activity, NOW()) as days_since_active
      FROM referrals r
      INNER JOIN streamers s ON r.referee_id = s.id
      LEFT JOIN streamer_levels sl ON s.id = sl.streamer_id
      WHERE r.referrer_id = ?
      ORDER BY r.signup_date DESC
      LIMIT ? OFFSET ?
    `, [streamerId, limit, offset]);
    
    // Compter le total
    const [countRows] = await db.query(`
      SELECT COUNT(*) as total
      FROM referrals
      WHERE referrer_id = ?
    `, [streamerId]);
    
    const total = countRows[0].total;
    
    res.json({
      success: true,
      data: {
        referrals: referrals.map(r => ({
          id: r.id,
          referee: {
            id: r.referee_id,
            login: r.referee_login,
            displayName: r.referee_name,
            avatar: r.referee_avatar,
            level: r.referee_level,
            teamCoins: r.referee_coins
          },
          signupDate: r.signup_date,
          isActive: r.is_active === 1,
          lastActivity: r.last_activity,
          daysSinceActive: r.days_since_active
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: (offset + limit) < total
        }
      }
    });
    
  } catch (err) {
    console.error('[GET /api/referral/referrals]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 4. TRACKER UN CLIC SUR LE LIEN DE PARRAINAGE
// ========================================

/**
 * POST /api/referral/track-click
 * Enregistre un clic sur un lien de parrainage
 * Body: { code, source?, userAgent?, ip? }
 */
app.post('/api/referral/track-click', async (req, res) => {
  try {
    const { code, source } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code de parrainage requis' });
    }
    
    // Vérifier que le code existe
    const [streamer] = await db.query(`
      SELECT id FROM streamers WHERE referral_code = ?
    `, [code]);
    
    if (streamer.length === 0) {
      return res.status(404).json({ error: 'Code de parrainage invalide' });
    }
    
    const streamerId = streamer[0].id;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');
    
    // Enregistrer le clic
    await db.query(`
      INSERT INTO referral_analytics (
        streamer_id,
        referral_code,
        event_type,
        source,
        ip_address,
        user_agent
      ) VALUES (?, ?, 'click', ?, ?, ?)
    `, [streamerId, code, source || 'direct', ipAddress, userAgent]);
    
    res.json({
      success: true,
      message: 'Clic enregistré'
    });
    
  } catch (err) {
    console.error('[POST /api/referral/track-click]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 5. ANALYTICS DÉTAILLÉES
// ========================================

/**
 * GET /api/referral/analytics?period=7d
 * Analytics détaillées du parrainage
 */
app.get('/api/referral/analytics', requireAuth, async (req, res) => {
  try {
    const streamerId = req.session.user.id;
    const period = req.query.period || '7d';
    
    const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
    
    // Récupérer le code
    const [codeRow] = await db.query(`
      SELECT referral_code FROM streamers WHERE id = ?
    `, [streamerId]);
    
    if (codeRow.length === 0) {
      return res.status(404).json({ error: 'Code introuvable' });
    }
    
    const code = codeRow[0].referral_code;
    
    // Nombre de clics
    const [clicks] = await db.query(`
      SELECT COUNT(*) as total_clicks
      FROM referral_analytics
      WHERE referral_code = ?
      AND event_type = 'click'
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [code, days]);
    
    // Nombre d'inscriptions
    const [signups] = await db.query(`
      SELECT COUNT(*) as total_signups
      FROM referrals
      WHERE referrer_id = ?
      AND signup_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [streamerId, days]);
    
    const totalClicks = clicks[0].total_clicks;
    const totalSignups = signups[0].total_signups;
    const conversionRate = totalClicks > 0 ? ((totalSignups / totalClicks) * 100).toFixed(1) : 0;
    
    // Sources de trafic
    const [sources] = await db.query(`
      SELECT 
        source,
        COUNT(*) as count
      FROM referral_analytics
      WHERE referral_code = ?
      AND event_type = 'click'
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY source
      ORDER BY count DESC
    `, [code, days]);
    
    // Stats quotidiennes
    const [dailyStats] = await db.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as clicks
      FROM referral_analytics
      WHERE referral_code = ?
      AND event_type = 'click'
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [code, days]);
    
    res.json({
      success: true,
      data: {
        clicks: totalClicks,
        signups: totalSignups,
        conversionRate: parseFloat(conversionRate),
        sourceBreakdown: sources.reduce((acc, s) => {
          acc[s.source || 'Direct'] = s.count;
          return acc;
        }, {}),
        dailyStats: dailyStats.map(d => ({
          date: d.date,
          clicks: d.clicks
        }))
      }
    });
    
  } catch (err) {
    console.error('[GET /api/referral/analytics]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 6. CLASSEMENT DES PARRAINS
// ========================================

/**
 * GET /api/referral/leaderboard?limit=50
 * Classement des meilleurs parrains
 */
app.get('/api/referral/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    const [rows] = await db.query(`
      SELECT 
        streamer_id,
        login,
        display_name,
        profile_image_url,
        referral_code,
        total_referrals,
        active_referrals,
        ranking
      FROM v_referral_leaderboard
      LIMIT ?
    `, [limit]);
    
    res.json({
      success: true,
      data: rows.map(r => ({
        streamerId: r.streamer_id,
        login: r.login,
        displayName: r.display_name,
        avatar: r.profile_image_url,
        referralCode: r.referral_code,
        totalReferrals: r.total_referrals,
        activeReferrals: r.active_referrals,
        position: r.ranking
      }))
    });
    
  } catch (err) {
    console.error('[GET /api/referral/leaderboard]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 7. VALIDER UN CODE DE PARRAINAGE
// ========================================

/**
 * GET /api/referral/validate-code/:code
 * Vérifie qu'un code de parrainage existe et retourne les infos du parrain
 */
app.get('/api/referral/validate-code/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    const [rows] = await db.query(`
      SELECT 
        id,
        login,
        display_name,
        profile_image_url
      FROM streamers
      WHERE referral_code = ?
    `, [code]);
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Code de parrainage invalide' 
      });
    }
    
    const referrer = rows[0];
    
    res.json({
      success: true,
      valid: true,
      data: {
        referrerId: referrer.id,
        referrerLogin: referrer.login,
        referrerName: referrer.display_name,
        referrerAvatar: referrer.profile_image_url,
        code: code
      }
    });
    
  } catch (err) {
    console.error('[GET /api/referral/validate-code]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 8. ENREGISTRER UN PARRAINAGE (lors de l'inscription)
// ========================================

/**
 * POST /api/referral/register
 * Enregistre un nouveau parrainage
 * Body: { referralCode, refereeId }
 * Cette fonction est appelée lors de l'inscription OAuth
 */
app.post('/api/referral/register', async (req, res) => {
  try {
    const { referralCode, refereeId } = req.body;
    
    if (!referralCode || !refereeId) {
      return res.status(400).json({ error: 'Code et ID requis' });
    }
    
    // Vérifier que le code existe
    const [referrer] = await db.query(`
      SELECT id FROM streamers WHERE referral_code = ?
    `, [referralCode]);
    
    if (referrer.length === 0) {
      return res.status(404).json({ error: 'Code invalide' });
    }
    
    const referrerId = referrer[0].id;
    
    // Vérifier que le filleul ne se parraine pas lui-même
    if (referrerId === refereeId) {
      return res.status(400).json({ error: 'Tu ne peux pas te parrainer toi-même' });
    }
    
    // Vérifier que le filleul n'a pas déjà été parrainé
    const [existing] = await db.query(`
      SELECT id FROM referrals WHERE referee_id = ?
    `, [refereeId]);
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Déjà parrainé' });
    }
    
    // Enregistrer le parrainage
    await db.query(`
      INSERT INTO referrals (
        referrer_id,
        referee_id,
        referral_code,
        signup_date,
        is_active
      ) VALUES (?, ?, ?, NOW(), 0)
    `, [referrerId, refereeId, referralCode]);
    
    // Le trigger after_referral_insert va automatiquement :
    // - Ajouter 100 TC au parrain
    // - Ajouter 25 TC au filleul
    
    // Enregistrer dans les analytics
    await db.query(`
      INSERT INTO referral_analytics (
        streamer_id,
        referral_code,
        event_type,
        metadata
      ) VALUES (?, ?, 'signup', ?)
    `, [referrerId, referralCode, JSON.stringify({ referee_id: refereeId })]);

// ========================================
// 🎖️ Vérifie si le parrain atteint un palier de filleuls pour un badge
// ========================================
try {
  const [[stats]] = await db.query(`
    SELECT COUNT(*) AS total FROM referrals WHERE referrer_id = ?
  `, [referrerId]);

  const total = stats.total || 0;

  if (total >= 5)  await addBadge(referrerId, 'recruiter_bronze', 'Recruteur Bronze', '🥉');
  if (total >= 10) await addBadge(referrerId, 'recruiter_silver', 'Recruteur Argent', '🥈');
  if (total >= 25) await addBadge(referrerId, 'recruiter_gold', 'Recruteur Or', '🥇');
  if (total >= 50) await addBadge(referrerId, 'recruiter_platinum', 'Recruteur Platine', '💎');
  if (total >= 100) await addBadge(referrerId, 'recruiter_legend', 'Recruteur Légende', '👑');

  console.log(`🎯 Vérification des badges de parrainage terminée pour ${referrerId} (${total} filleuls).`);
} catch (err) {
  console.error('[referral/register] Erreur attribution badge :', err);
}
    
    res.json({
      success: true,
      message: 'Parrainage enregistré',
      bonusCoins: 25
    });
    
  } catch (err) {
    console.error('[POST /api/referral/register]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========================================
// 9. VÉRIFIER SI UN FILLEUL DOIT ÊTRE MARQUÉ ACTIF
// ========================================

/**
 * POST /api/referral/check-active
 * Vérifie et marque un filleul comme actif si conditions remplies
 * Body: { userId }
 */
app.post('/api/referral/check-active', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Vérifier si cet utilisateur est un filleul
    const [referral] = await db.query(`
      SELECT id, is_active FROM referrals WHERE referee_id = ?
    `, [userId]);
    
    if (referral.length === 0) {
      return res.json({ success: true, message: 'Pas un filleul' });
    }
    
    if (referral[0].is_active === 1) {
      return res.json({ success: true, message: 'Déjà actif' });
    }
    
    // Vérifier les conditions pour devenir actif
    // Condition : 3+ connexions OU 1+ quête complétée
    const [stats] = await db.query(`
      SELECT 
        (SELECT COUNT(DISTINCT DATE(created_at)) FROM salves WHERE sender_id = ? OR receiver_id = ?) as connection_days,
        (SELECT COUNT(*) FROM streamer_quests WHERE streamer_id = ? AND completed = 1) as quests_completed
    `, [userId, userId, userId]);
    
    const connectionDays = stats[0].connection_days || 0;
    const questsCompleted = stats[0].quests_completed || 0;
    
    if (connectionDays >= 3 || questsCompleted >= 1) {
      // Marquer comme actif via la procédure stockée
      await db.query(`CALL mark_referee_active(?)`, [userId]);
      
      return res.json({
        success: true,
        message: 'Marqué comme actif !',
        bonusEarned: true
      });
    }
    
    res.json({
      success: true,
      message: 'Pas encore actif',
      progress: {
        connectionDays,
        questsCompleted,
        needConnectionDays: 3,
        needQuestsCompleted: 1
      }
    });
    
  } catch (err) {
    console.error('[POST /api/referral/check-active]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

console.log('👥 API Système de Parrainage installée');

// ========================================
// LANCEMENT DU SERVEUR
// ========================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
  console.log("📍 OAuth Twitch configuré");
  console.log("🔗 URL: " + (process.env.BASE_URL || "http://localhost:3000"));
});
