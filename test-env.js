require("dotenv").config();

console.log("=== TEST .ENV ===\n");

// Affiche les variables d'environnement
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_USER:", process.env.DB_USER);
console.log(
  "DB_PASSWORD:",
  process.env.DB_PASSWORD ? "✓ (caché)" : "✗ Manquant"
);
console.log("DB_NAME:", process.env.DB_NAME);
console.log("PORT:", process.env.PORT);
console.log(
  "TWITCH_CLIENT_ID:",
  process.env.TWITCH_CLIENT_ID ? "✓ (caché)" : "✗ Manquant"
);
console.log(
  "TWITCH_CLIENT_SECRET:",
  process.env.TWITCH_CLIENT_SECRET ? "✓ (caché)" : "✗ Manquant"
);
console.log("BASE_URL:", process.env.BASE_URL);

console.log("\n=== TEST CONNEXION BD ===\n");

const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.getConnection()
  .then((conn) => {
    console.log("✅ Connexion BD réussie !");
    conn.release();
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Erreur connexion BD:", err.message);
    process.exit(1);
  });
