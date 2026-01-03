USE stream_team;

-- =======================================================
-- 🕓 Script de synchronisation automatique des Team Coins
-- Compatible avec secure-file-priv
-- =======================================================

-- 1️⃣ Synchroniser les soldes des portefeuilles
UPDATE streamer_wallets sw
JOIN (
  SELECT streamer_id, COALESCE(SUM(amount),0) AS total
  FROM team_coins_transactions
  GROUP BY streamer_id
) t ON sw.streamer_id = t.streamer_id
SET sw.balance = t.total;

SET @wallets_updated := ROW_COUNT();

-- 2️⃣ Synchroniser les niveaux
UPDATE streamer_levels sl
JOIN streamer_wallets sw ON sl.streamer_id = sw.streamer_id
SET sl.team_coins = sw.balance;

SET @levels_updated := ROW_COUNT();

-- 3️⃣ Ajouter un log en base
INSERT INTO wallet_sync_log (updated_wallets, updated_levels, comment)
VALUES (@wallets_updated, @levels_updated, CONCAT('Synchro automatique cron - ', NOW()));
