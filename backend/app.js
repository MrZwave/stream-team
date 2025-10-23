require("dotenv").config();
const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const app = express();
// Indique à Express qu'il est derrière un proxy comme NGINX
app.set("trust proxy", true);
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
// 🆕 Middleware réécriture d’URL (sans .html)
// ========================================
app.use((req, res, next) => {
  let filePath;

  // Racine
  if (req.path === "/") {
    filePath = path.join(__dirname, "../frontend", "index.html");
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  // URL sans extension
  else if (!req.path.includes(".")) {
    filePath = path.join(__dirname, "../frontend", req.path + ".html");
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  // Redirection des .html vers URL sans extension
  else if (req.path.endsWith(".html")) {
    return res.redirect(301, req.path.slice(0, -5));
  }

  next();
});

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, "../frontend")));


// ========================================
// 🌐 Servir les fichiers statiques du front
// ========================================
app.use(express.static(path.join(__dirname, "frontend")));

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
      user: req.session.user,
    });
  } else {
    res.status(401).json({ authenticated: false });
  }
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

app.post(
  "/api/admin/streamers/:id/toggle-admin",
  requireAdmin,
  async (req, res) => {
    const id = parseInt(req.params.id);
    const { is_admin } = req.body;

    try {
      await db.query("UPDATE streamers SET is_admin = ? WHERE id = ?", [
        is_admin ? 1 : 0,
        id,
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error("Erreur toggle admin:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
);

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
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des cartes" });
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
      [
        name,
        rarity,
        image_url || null,
        description || null,
        unlock_condition || null,
      ]
    );

    logCardEvent(
      `[CREATE] Carte ajoutée : ID=${result.insertId}, Nom=${name}, Rareté=${rarity}`
    );
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
      [
        name,
        rarity,
        image_url || null,
        description || null,
        unlock_condition || null,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Carte introuvable." });
    }

    logCardEvent(
      `[UPDATE] Carte modifiée : ID=${id}, Nom=${name}, Rareté=${rarity}`
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/admin/cards/:id] Erreur SQL :", err);
    logCardEvent(`[ERROR UPDATE] ${err.message}`);
    res
      .status(500)
      .json({ error: "Erreur lors de la modification de la carte." });
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
    res
      .status(500)
      .json({ error: "Erreur lors de la suppression de la carte." });
  }
});

// CRUD Quêtes
app.get("/api/admin/quests", requireAdmin, async (req, res) => {
  try {
    const [quests] = await db.query("SELECT * FROM quests ORDER BY id DESC");
    res.json(quests);
  } catch (err) {
    console.error("[GET /api/admin/quests] Erreur SQL :", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des quêtes." });
  }
});

app.post("/api/admin/quests", requireAdmin, async (req, res) => {
  const { title, description, reward_points, is_active } = req.body;

  if (!title || reward_points === undefined) {
    return res
      .status(400)
      .json({ error: "Titre et points de récompense requis." });
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
    return res
      .status(400)
      .json({ error: "Titre et points de récompense requis." });
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

app.get("/streamer/:name", async (req, res) => {
  const name = req.params.name;

  try {
    const token = await getAppAccessToken();

    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(name)}`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const userData = (await userRes.json()).data[0];
    if (!userData) throw new Error(`Utilisateur Twitch introuvable: ${name}`);

    const clipsRes = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${userData.id}&first=6`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const clipsData = await clipsRes.json();
    const clips = clipsData.data || [];

    const [rows] = await db.query(
      "SELECT clicks, salves FROM streamers WHERE login = ?",
      [name]
    );
    const userStats = rows[0] || { clicks: 0, salves: 0 };

    res.render("streamer", {
      userData,
      clips,
      userStats,
    });
  } catch (err) {
    console.error("Erreur profil:", err);
    res.status(500).send("Erreur lors du chargement du profil.");
  }
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

// Fallback error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (req.path.startsWith("/api/"))
    return res.status(500).json({ error: "Internal Server Error" });
  next();
});

// ========================================
// 🚀 LANCEMENT SERVEUR
// ========================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
  console.log("📍 OAuth Twitch configuré");
  console.log("🔗 URL: " + (process.env.BASE_URL || "http://localhost:3000"));
});
