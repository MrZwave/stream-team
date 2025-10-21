require("dotenv").config();
const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const fetch = require("node-fetch"); // ✅ version node-fetch 2.x
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

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

// Route de test de session
app.get("/test-session", (req, res) => {
  req.session.views = (req.session.views || 0) + 1;
  res.send(`Session OK. Views: ${req.session.views}`);
});

app.get("/auth/twitch", (req, res) => {
  const redirect_uri = `${process.env.BASE_URL}/auth/twitch/callback`;
  res.redirect(
    `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=code&scope=user:read:email user:edit:follows`
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

// Fonction pour obtenir l'ID Twitch d'un login
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
    // ➕ Incrémente les clics à chaque chargement
    await db.query("UPDATE streamers SET clicks = clicks + 1 WHERE login = ?", [
      login,
    ]);

    // 🎯 Statistiques
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

app.post("/api/salve", async (req, res) => {
  const login = req.body.login;
  if (!login)
    return res.status(400).json({ success: false, error: "Login manquant" });

  try {
    await db.query(`UPDATE streamers SET salves = salves + 1 WHERE login = ?`, [
      login,
    ]);
    const [[{ salves }]] = await db.query(
      `SELECT salves FROM streamers WHERE login = ?`,
      [login]
    );
    res.json({ success: true, salves });
  } catch (err) {
    console.error("[API SALVE]", err);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

const checkLiveStreams = async () => {
  try {
    const [rows] = await db.query("SELECT login FROM streamers");
    const logins = rows.map((r) => r.login);

    if (logins.length === 0) return;

    const query = logins.map((login) => `user_login=${login}`).join("&");
    const twitchRes = await fetch(
      `https://api.twitch.tv/helix/streams?${query}`,
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${process.env.TWITCH_OAUTH_TOKEN}`,
        },
      }
    );

    const data = await twitchRes.json();
    const liveLogins = data.data.map((stream) => stream.user_login);

    for (const login of liveLogins) {
      // Vérifie si un live existe déjà aujourd'hui
      const [[existing]] = await db.query(
        `SELECT id FROM live_streams WHERE login = ? AND DATE(started_at) = CURDATE()`,
        [login]
      );

      if (!existing) {
        await db.query(
          `INSERT INTO live_streams (login, started_at, ended_at) VALUES (?, NOW(), NOW())`,
          [login]
        );
        console.log(`✔️ Live ajouté pour ${login}`);
      }
    }
  } catch (err) {
    console.error("Erreur checkLiveStreams:", err);
  }
};

// Déconnexion
app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/")));

// --- API ---
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
  return data.access_token;
}

app.get("/api/me", async (req, res) => {
  if (!req.session.user)
    return res.status(401).json({ error: "Not logged in" });

  try {
    const [rows] = await db.query(
      "SELECT id, login, display_name, profile_image_url, is_admin FROM streamers WHERE id = ?",
      [req.session.user.id]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    res.json(rows[0]);
  } catch (err) {
    console.error("[API /me]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/streamers", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT login FROM streamers");
    res.json(rows.map((r) => r.login));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/live", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT login FROM streamers");
    const users = rows.map((r) => r.login);
    if (!users.length) return res.json({ allUsers: [], liveData: [] });

    const token = await getAppAccessToken();
    const qs = users
      .map((u) => `user_login=${encodeURIComponent(u)}`)
      .join("&");
    const liveRes = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    const liveJson = await liveRes.json();
    const streams = liveJson.data || [];

    // 🔴 Enregistrer chaque live dans la base s’il est nouveau
    for (const stream of streams) {
      try {
        await db.execute(
          `
          INSERT IGNORE INTO live_streams 
          (login, stream_id, title, game_name, viewer_count, started_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          [
            stream.user_login,
            stream.id,
            stream.title,
            stream.game_name,
            stream.viewer_count,
            new Date(stream.started_at),
          ]
        );
      } catch (err) {
        console.error(`[Erreur DB] stream ${stream.id}`, err);
      }
    }

    res.json({ allUsers: users, liveData: streams });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/users", async (req, res) => {
  let logins = req.query.login;
  if (!logins) return res.status(400).json({ error: "No login" });
  if (!Array.isArray(logins)) logins = [logins];
  try {
    const token = await getAppAccessToken();
    const qs = logins.map((l) => `login=${encodeURIComponent(l)}`).join("&");
    const userRes = await fetch(`https://api.twitch.tv/helix/users?${qs}`, {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    const userJson = await userRes.json();
    res.json(userJson);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/lives-count", async (req, res) => {
  const login = req.query.login;
  if (!login) return res.status(400).json({ error: "Missing login parameter" });

  try {
    const [[{ count }]] = await db.query(
      `SELECT COUNT(*) AS count FROM live_streams WHERE login = ?`,
      [login]
    );
    res.json({ count });
  } catch (err) {
    console.error("[API /lives-count Error]", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Récupérer les notifications visibles côté client
app.get("/api/notifications", async (req, res) => {
  try {
    const userId = req.session.user?.id || 0;

    // 1. Notifications classiques avec suivi de lecture
    const [notifications] = await db.query(
      `
      SELECT n.id, n.type, n.title, n.message, n.category, n.icon, n.created_at,
        CASE WHEN un.read_at IS NULL THEN 0 ELSE 1 END AS \'read'\
      FROM notifications n
      LEFT JOIN user_notifications un ON n.id = un.notification_id AND un.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 20
    `,
      [userId]
    );

    // 2. Quêtes dynamiques à afficher comme notifications
    const [quests] = await db.query(`
      SELECT id, name, description, type, xp_reward
      FROM quests
    `);

    // 🔍 LOG ICI a supprimé
    console.log("[Quêtes récupérées pour notifications]:", quests);

    const questNotifs = quests.map((q) => ({
      id: `quest-${q.id}`,
      type: "mission",
      title: `📜 ${q.name}`,
      message: `${q.description} (XP: ${q.xp_reward})`,
      category: q.type,
      icon: "🎯",
      created_at: new Date().toISOString(),
      read: false,
    }));
    // 3. Fusion des deux
    const allNotifs = [...questNotifs, ...notifications];

    res.json(allNotifs);
  } catch (err) {
    console.error("Erreur récupération notifications:", err);
    res.status(500).json([]);
  }
});

app.post("/api/notifications/read", async (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) return res.status(403).json({ error: "Non autorisé" });

  try {
    const [rows] = await db.query("SELECT id FROM notifications LIMIT 20");
    const values = rows.map((row) => [userId, row.id]);

    if (values.length > 0) {
      await db.query(
        `
        INSERT IGNORE INTO user_notifications (user_id, notification_id)
        VALUES ?
      `,
        [values]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Erreur marquage notifs comme lues:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/admin/streamers", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, login, display_name, is_admin FROM streamers"
    );
    res.json(rows);
  } catch (err) {
    console.error("[Admin Streamers]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/admin/cards", requireAdmin, async (req, res) => {
  res.json([]);
});

app.get("/api/admin/user-cards/:id", requireAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    // Si la table n'existe pas encore, on retourne une liste vide temporairement
    const [rows] = await db.query(
      `
      SELECT uc.id, ct.name, ct.rarity
      FROM user_cards uc
      JOIN card_templates ct ON uc.card_template_id = ct.id
      WHERE uc.user_id = ?
    `,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") {
      console.warn(
        "🔧 Table user_cards ou card_templates manquante. Retourne []"
      );
      return res.json([]); // temporaire
    }

    console.error("[Admin User Cards]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/admin/push-notification", requireAdmin, async (req, res) => {
  try {
    const { type, message } = req.body;
    const icons = {
      update: "✅",
      mission: "🎯",
      tip: "🧠",
      reward: "🎁",
    };

    const icon = icons[type] || "ℹ️";
    const category =
      {
        update: "system",
        mission: "missions",
        tip: "tips",
        reward: "rewards",
      }[type] || "system";

    const title =
      {
        update: "Mise à jour",
        mission: "Nouvelle mission",
        tip: "Conseil du jour",
        reward: "Récompense débloquée",
      }[type] || "Notification";

    await db.execute(
      `
      INSERT INTO notifications (type, title, message, category, icon, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `,
      [type, title, message, category, icon]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Erreur notif admin:", err);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// Route pour ajouter une quête
app.post("/api/admin/quests", requireAdmin, async (req, res) => {
  const { name, description, type, xp_reward, requirement, card_reward } =
    req.body;

  if (!name || !description || !type || !xp_reward || !requirement) {
    return res.status(400).json({ error: "Tous les champs sont requis." });
  }

  try {
    const questInsertQuery = `
      INSERT INTO quests (name, description, type, xp_reward, requirement, card_reward_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.execute(questInsertQuery, [
      name,
      description,
      type,
      xp_reward,
      requirement,
      card_reward || null, // Peut être null si pas de récompense de carte
    ]);

    res.json({ success: true, message: "Quête ajoutée avec succès !" });
  } catch (error) {
    console.error("Erreur ajout quête:", error);
    res
      .status(500)
      .json({ error: "Erreur serveur lors de l'ajout de la quête." });
  }
});

app.get("/api/admin/quests", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name, description, type, xp_reward, requirement, card_reward_id
      FROM quests
      ORDER BY created_at DESC
    `);

    res.json({ success: true, quests: rows });
  } catch (err) {
    console.error("[GET /api/admin/quests] Erreur SQL :", err);
    res.status(500).json({ error: "Erreur lors du chargement des quêtes." });
  }
});

app.delete("/api/admin/quests/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalide." });

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

// Fallback error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (req.path.startsWith("/api/"))
    return res.status(500).json({ error: "Internal Server Error" });
  next();
});

app.get("/api/debug-session", (req, res) => {
  res.json(req.session.user || { error: "No session user" });
});

app.use((req, res, next) => {
  console.log("[PROTO]", req.headers["x-forwarded-proto"]);
  console.log(`[REQ] ${req.method} ${req.url}`);
  console.log(`[HDR] x-forwarded-proto: ${req.headers["x-forwarded-proto"]}`);
  console.log(`[COOKIES] ${req.headers.cookie}`);
  next();
});

// Page de test url dynamique
app.get("/test", (req, res) => {
  res.render("test", { username: "MrZwave" });
});

app.get("/streamer/:name", async (req, res) => {
  const name = req.params.name;

  try {
    const token = await getAppAccessToken();

    // 🔹 Récupérer les infos utilisateur depuis l’API Twitch
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

    // 🔹 Récupérer les clips Twitch
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

    // 🔹 Récupérer les stats personnalisées depuis ta BDD
    const [rows] = await db.query(
      "SELECT clicks, salves FROM streamers WHERE login = ?",
      [name]
    );
    const userStats = rows[0] || { clicks: 0, salves: 0 };

    // 🔹 Rendu de la page
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

// Fichiers statiques (frontend)
app.use(express.static(path.join(__dirname, "frontend")));

app.get("/api/debug", (req, res) => {
  res.send("✅ API en ligne et à jour");
});

app.get("/api/debug-session", (req, res) => {
  res.json({
    sessionUser: req.session.user || null,
  });
});

//---------------------------------------------------------------------------
//Code LukDum

// Inscription
app.post("/api/user/add", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "Email et mot de passe requis",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      error: "Le mot de passe doit contenir au moins 8 caractères",
    });
  }

  try {
    const [existing] = await db.execute("SELECT id FROM user WHERE email = ?", [
      email,
    ]);

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Cet email est déjà utilisé",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const rolesJson = JSON.stringify(["user"]);

    const [result] = await db.execute(
      "INSERT INTO user (email, roles, password) VALUES (?, ?, ?)",
      [email, rolesJson, hashedPassword]
    );

    res.json({
      success: true,
      userId: result.insertId,
      message: "Utilisateur créé avec succès",
    });
  } catch (error) {
    console.error("Erreur inscription:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de l'inscription",
    });
  }
});

// Connexion
app.post("/api/user/login", async (req, res) => {
  console.log("--- LOGIN REQUEST ---");
  console.log("Body:", req.body);
  console.log("Session avant:", req.session);

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "Email et mot de passe requis",
    });
  }

  try {
    const [results] = await db.execute("SELECT * FROM user WHERE email = ?", [
      email,
    ]);

    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Email ou mot de passe incorrect",
      });
    }

    const user = results[0];

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Email ou mot de passe incorrect",
      });
    }

    let roles = [];
    try {
      roles = JSON.parse(user.roles);
    } catch (e) {
      console.warn("Erreur sur le role:", e);
      roles = ["user"];
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name || null,
      roles: roles,
      profile_image: user.image_name || null,
    };

    await db.execute("UPDATE user SET updated_at = NOW() WHERE id = ?", [
      user.id,
    ]);

    res.json({
      success: true,
      message: "Connexion réussie",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: roles,
      },
    });
  } catch (error) {
    console.error("Erreur connexion:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la connexion",
    });
  }
  console.log("Session après:", req.session);
  console.log("--- END LOGIN ---");
});

// Vérifier session
app.get("/api/user/check", (req, res) => {
  if (req.session && req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.status(401).json({ loggedIn: false });
  }
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Serveur lancé sur le port 3000");
  console.log(" Routes disponibles:");
  console.log("  POST /api/user/login");
  console.log("  POST /api/user/add");
  console.log("  GET  /api/user/check");
});
