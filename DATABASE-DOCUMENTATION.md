# 📊 Documentation Base de Données - Stream Team HQ

## 🗄️ Vue d'ensemble

Base de données MySQL pour la plateforme Stream Team HQ, une communauté de streamers francophones sur Twitch.

**Version:** 1.0  
**Date:** 2025-10-23  
**Charset:** utf8mb4_unicode_ci  
**Engine:** InnoDB

---

## 📋 Tables Principales

### 1. **streamers**
Stocke les informations des streamers de la plateforme.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INT (PK) | Identifiant unique auto-incrémenté |
| `login` | VARCHAR(255) UNIQUE | Login Twitch (unique) |
| `display_name` | VARCHAR(255) | Nom d'affichage Twitch |
| `profile_image_url` | TEXT | URL de l'avatar |
| `clicks` | INT | Nombre de clics sur le profil |
| `salves` | INT | Nombre de salves reçues |
| `is_admin` | BOOLEAN | Droits administrateur |
| `created_at_site` | TIMESTAMP | Date d'ajout sur le site |
| `updated_at` | TIMESTAMP | Dernière modification |

**Index:**
- `login` (UNIQUE)
- `clicks`, `salves`

---

### 2. **sessions**
Gestion des sessions utilisateurs (express-session + MySQL).

| Colonne | Type | Description |
|---------|------|-------------|
| `session_id` | VARCHAR(128) (PK) | ID de session |
| `expires` | INT UNSIGNED | Timestamp d'expiration |
| `data` | MEDIUMTEXT | Données de session (JSON) |

---

### 3. **notifications**
Notifications système pour tous les utilisateurs.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INT (PK) | Identifiant unique |
| `type` | VARCHAR(50) | Type : info, update, alert, community |
| `title` | VARCHAR(255) | Titre de la notification |
| `message` | TEXT | Message complet |
| `category` | VARCHAR(50) | Catégorie : system, community, missions |
| `icon` | VARCHAR(50) | Emoji/icône |
| `created_at` | TIMESTAMP | Date de création |

---

### 4. **user_notifications**
Suivi des notifications lues par chaque utilisateur.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INT (PK) | Identifiant unique |
| `user_id` | INT | ID utilisateur (0 si non connecté) |
| `notification_id` | INT (FK) | Référence vers notifications |
| `read_at` | TIMESTAMP NULL | Date de lecture (NULL = non lu) |
| `created_at` | TIMESTAMP | Date de création |

**Contraintes:**
- UNIQUE (user_id, notification_id)
- FOREIGN KEY → notifications.id (CASCADE)

---

### 5. **twitch_clips**
Clips Twitch sauvegardés par les utilisateurs.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INT (PK) | Identifiant unique |
| `clip_id` | VARCHAR(255) UNIQUE | ID du clip Twitch |
| `broadcaster_login` | VARCHAR(255) | Login du streamer |
| `broadcaster_name` | VARCHAR(255) | Nom du streamer |
| `title` | TEXT | Titre du clip |
| `url` | TEXT | URL du clip |
| `embed_url` | TEXT | URL d'embed |
| `thumbnail_url` | TEXT | URL de la miniature |
| `view_count` | INT | Nombre de vues |
| `created_at` | TIMESTAMP | Date de création Twitch |
| `duration` | FLOAT | Durée en secondes |
| `saved_by_user_id` | INT | ID utilisateur ayant sauvegardé |
| `saved_at` | TIMESTAMP | Date de sauvegarde |

---

### 6. **quests**
Système de quêtes et défis.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INT (PK) | Identifiant unique |
| `title` | VARCHAR(255) | Titre de la quête |
| `description` | TEXT | Description détaillée |
| `type` | VARCHAR(50) | Type : profile_visit, clip_save, salve_send |
| `difficulty` | VARCHAR(20) | Difficulté : easy, medium, hard |
| `reward_points` | INT | Points gagnés |
| `reward_badge` | VARCHAR(100) | Badge débloqué |
| `requirement_value` | INT | Objectif à atteindre |
| `is_active` | BOOLEAN | Quête active ou non |
| `start_date` | TIMESTAMP NULL | Date de début |
| `end_date` | TIMESTAMP NULL | Date de fin |
| `created_at` | TIMESTAMP | Date de création |
| `updated_at` | TIMESTAMP | Dernière modification |

---

### 7. **cards**
Système de cartes à collectionner (fonctionnalité future).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INT (PK) | Identifiant unique |
| `name` | VARCHAR(255) | Nom de la carte |
| `description` | TEXT | Description |
| `rarity` | VARCHAR(50) | Rareté : common, rare, epic, legendary |
| `image_url` | TEXT | URL de l'image |
| `streamer_login` | VARCHAR(255) | Streamer associé |
| `stats` | JSON | Statistiques de la carte |
| `created_at` | TIMESTAMP | Date de création |

---

## 📊 Vues

### `v_top_streamers_clicks`
Top 50 des streamers par nombre de clics.

### `v_top_streamers_salves`
Top 50 des streamers par nombre de salves.

### `v_global_stats`
Statistiques globales de la plateforme :
- Total streamers
- Total clics
- Total salves
- Total clips
- Quêtes actives
- Total notifications

---

## 🔧 Procédures Stockées

### `clean_old_sessions()`
Nettoie les sessions expirées.

```sql
CALL clean_old_sessions();
```

### `clean_old_notifications()`
Supprime les notifications de plus de 90 jours (sauf catégorie "important").

```sql
CALL clean_old_notifications();
```

---

## 🚀 Installation

```bash
# Importer la base
mysql -u root -p < stream-team-database-complete.sql

# Ou depuis MySQL
mysql -u root -p
source /chemin/vers/stream-team-database-complete.sql
```

---

## 📝 Configuration .env

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=ton_mot_de_passe
DB_NAME=stream_team
```

---

## 🔐 Sécurité

- Toutes les tables utilisent `utf8mb4_unicode_ci` pour supporter les émojis
- Index sur les colonnes fréquemment utilisées
- Foreign keys avec CASCADE DELETE
- Contraintes UNIQUE pour éviter les doublons

---

## 📈 Maintenance Recommandée

### Quotidienne
```sql
CALL clean_old_sessions();
```

### Hebdomadaire
```sql
CALL clean_old_notifications();
OPTIMIZE TABLE streamers, sessions, notifications;
```

### Mensuelle
```sql
-- Analyser les performances
ANALYZE TABLE streamers, twitch_clips, notifications;

-- Vérifier l'intégrité
CHECK TABLE streamers, twitch_clips;
```

---

## 📊 Requêtes Utiles

### Statistiques globales
```sql
SELECT * FROM v_global_stats;
```

### Top 10 streamers
```sql
SELECT login, display_name, clicks, salves 
FROM streamers 
ORDER BY clicks DESC 
LIMIT 10;
```

### Clips les plus populaires
```sql
SELECT title, broadcaster_name, view_count, url
FROM twitch_clips
ORDER BY view_count DESC
LIMIT 20;
```

### Notifications non lues d'un utilisateur
```sql
SELECT n.* 
FROM notifications n
LEFT JOIN user_notifications un 
  ON n.id = un.notification_id AND un.user_id = 123
WHERE un.id IS NULL OR un.read_at IS NULL
ORDER BY n.created_at DESC;
```

---

## 🆘 Support

Pour toute question sur la structure de la base de données, contactez l'équipe de développement Stream Team HQ.

**Version:** 1.0  
**Dernière mise à jour:** 2025-10-23
