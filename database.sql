-- ========================================
-- 🗄️ BASE DE DONNÉES STREAM TEAM HQ
-- ========================================
-- Version: 1.0
-- Date: 2025-10-23
-- Description: Base de données complète pour la plateforme Stream Team

-- Création de la base de données
CREATE DATABASE IF NOT EXISTS stream_team CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE stream_team;

-- ========================================
-- 📋 TABLE: streamers
-- ========================================
-- Description: Informations sur les streamers de la plateforme
CREATE TABLE IF NOT EXISTS streamers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  profile_image_url TEXT,
  clicks INT DEFAULT 0,
  salves INT DEFAULT 0,
  created_at_site TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_login (login),
  INDEX idx_clicks (clicks),
  INDEX idx_salves (salves)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 📋 TABLE: sessions
-- ========================================
-- Description: Sessions utilisateurs pour l'authentification
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  INDEX expires_idx (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 📋 TABLE: notifications
-- ========================================
-- Description: Notifications système pour tous les utilisateurs
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL DEFAULT 'info',
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  category VARCHAR(50) DEFAULT 'system',
  icon VARCHAR(50) DEFAULT '🔔',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created_at (created_at),
  INDEX idx_category (category),
  INDEX idx_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 📋 TABLE: user_notifications
-- ========================================
-- Description: Suivi des notifications lues par utilisateur
CREATE TABLE IF NOT EXISTS user_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  notification_id INT NOT NULL,
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_notif (user_id, notification_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_notification_id (notification_id),
  INDEX idx_read_at (read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 📋 TABLE: twitch_clips
-- ========================================
-- Description: Clips Twitch sauvegardés par les utilisateurs
CREATE TABLE IF NOT EXISTS twitch_clips (
  id INT AUTO_INCREMENT PRIMARY KEY,
  clip_id VARCHAR(255) NOT NULL UNIQUE,
  broadcaster_login VARCHAR(255) NOT NULL,
  broadcaster_name VARCHAR(255),
  title TEXT,
  url TEXT,
  embed_url TEXT,
  thumbnail_url TEXT,
  view_count INT DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  duration FLOAT,
  saved_by_user_id INT,
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_clip_id (clip_id),
  INDEX idx_broadcaster (broadcaster_login),
  INDEX idx_saved_by (saved_by_user_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 📋 TABLE: quests
-- ========================================
-- Description: Quêtes et défis pour les utilisateurs
CREATE TABLE IF NOT EXISTS quests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL,
  difficulty VARCHAR(20) DEFAULT 'easy',
  reward_points INT DEFAULT 0,
  reward_badge VARCHAR(100),
  requirement_value INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  start_date TIMESTAMP NULL,
  end_date TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_type (type),
  INDEX idx_difficulty (difficulty),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 📋 TABLE: cards
-- ========================================
-- Description: Cartes à collectionner (fonctionnalité future)
CREATE TABLE IF NOT EXISTS cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  rarity VARCHAR(50) DEFAULT 'common',
  image_url TEXT,
  streamer_login VARCHAR(255),
  stats JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rarity (rarity),
  INDEX idx_streamer (streamer_login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 🌱 DONNÉES INITIALES
-- ========================================

-- Notifications de bienvenue
INSERT INTO notifications (type, title, message, category, icon) VALUES
('info', 'Bienvenue sur Stream Team HQ !', 'Découvre les fonctionnalités : stats, clips, quêtes et bien plus !', 'system', '🎉'),
('update', 'Nouvelle mise à jour', 'De nouvelles fonctionnalités sont disponibles dans la roadmap !', 'system', '🚀'),
('community', 'Rejoins la communauté', 'Plus de 127 streamers t\'attendent. Commence ton aventure !', 'community', '👥');

-- Quêtes de démarrage
INSERT INTO quests (title, description, type, difficulty, reward_points, requirement_value, is_active) VALUES
('Première visite', 'Visite le profil d\'un streamer', 'profile_visit', 'easy', 10, 1, TRUE),
('Collectionneur débutant', 'Sauvegarde ton premier clip', 'clip_save', 'easy', 20, 1, TRUE),
('Explorateur', 'Visite 5 profils différents', 'profile_visit', 'medium', 50, 5, TRUE),
('Supporter', 'Envoie ta première salve', 'salve_send', 'easy', 15, 1, TRUE),
('Fan de clips', 'Sauvegarde 10 clips', 'clip_save', 'medium', 100, 10, TRUE);

-- ========================================
-- 📊 VUES UTILES
-- ========================================

-- Vue: Top streamers par clics
CREATE OR REPLACE VIEW v_top_streamers_clicks AS
SELECT 
  login,
  display_name,
  profile_image_url,
  clicks,
  salves,
  created_at_site
FROM streamers
WHERE clicks > 0
ORDER BY clicks DESC
LIMIT 50;

-- Vue: Top streamers par salves
CREATE OR REPLACE VIEW v_top_streamers_salves AS
SELECT 
  login,
  display_name,
  profile_image_url,
  clicks,
  salves,
  created_at_site
FROM streamers
WHERE salves > 0
ORDER BY salves DESC
LIMIT 50;

-- Vue: Statistiques globales
CREATE OR REPLACE VIEW v_global_stats AS
SELECT 
  (SELECT COUNT(*) FROM streamers) as total_streamers,
  (SELECT SUM(clicks) FROM streamers) as total_clicks,
  (SELECT SUM(salves) FROM streamers) as total_salves,
  (SELECT COUNT(*) FROM twitch_clips) as total_clips,
  (SELECT COUNT(*) FROM quests WHERE is_active = TRUE) as active_quests,
  (SELECT COUNT(*) FROM notifications) as total_notifications;

-- ========================================
-- 🔐 UTILISATEURS & PERMISSIONS (OPTIONNEL)
-- ========================================

-- Si vous voulez ajouter une gestion d'admin
ALTER TABLE streamers ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;

-- ========================================
-- 📝 INDEXES DE PERFORMANCE
-- ========================================

-- Index composites pour améliorer les performances
CREATE INDEX idx_streamer_stats ON streamers(clicks, salves);
CREATE INDEX idx_clip_broadcaster_date ON twitch_clips(broadcaster_login, created_at);
CREATE INDEX idx_notifications_category_date ON notifications(category, created_at);

-- ========================================
-- 🧹 PROCÉDURES DE MAINTENANCE
-- ========================================

-- Procédure pour nettoyer les vieilles sessions (à exécuter régulièrement)
DELIMITER //
CREATE PROCEDURE clean_old_sessions()
BEGIN
  DELETE FROM sessions WHERE expires < UNIX_TIMESTAMP();
END//
DELIMITER ;

-- Procédure pour nettoyer les vieilles notifications (90 jours)
DELIMITER //
CREATE PROCEDURE clean_old_notifications()
BEGIN
  DELETE FROM notifications 
  WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND category != 'important';
END//
DELIMITER ;

-- ========================================
-- ✅ VÉRIFICATION FINALE
-- ========================================

-- Afficher toutes les tables
SHOW TABLES;

-- Afficher les statistiques
SELECT * FROM v_global_stats;

-- Message de confirmation
SELECT 'Base de données Stream Team HQ créée avec succès !' as message;
