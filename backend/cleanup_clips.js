require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7); // clips de plus de 7 jours

  try {
    const [res] = await db.execute(
      `DELETE FROM twitch_clips WHERE created_at < ?`,
      [cutoff.toISOString().slice(0, 19).replace('T', ' ')]
    );

    const logDir = path.join(__dirname, 'logs');
    const logPath = path.join(logDir, 'cleanup.log');
    fs.mkdirSync(logDir, { recursive: true });

    const log = `[${new Date().toISOString()}] Supprimé ${res.affectedRows} clip(s) plus vieux que 7 jours.\n`;
    fs.appendFileSync(logPath, log);
    console.log(log.trim());

    process.exit(0);
  } catch (err) {
    const logDir = path.join(__dirname, 'logs');
    const logPath = path.join(logDir, 'cleanup.log');
    fs.mkdirSync(logDir, { recursive: true });

    const errorLog = `[${new Date().toISOString()}] ERREUR: ${err.message}\n`;
    fs.appendFileSync(logPath, errorLog);
    console.error(errorLog.trim());

    process.exit(1);
  }
})();
