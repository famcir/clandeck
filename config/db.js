import mysql from 'mysql2/promise';
let pool;
const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (!dbUrl) console.error("MYSQL_URL missing!");
else {
  pool = mysql.createPool(dbUrl);
  pool.getConnection().then(async c => {
    console.log("DB Connected!"); c.release();
    await pool.query(`CREATE TABLE IF NOT EXISTS profile_groups (id VARCHAR(255) PRIMARY KEY, name VARCHAR(255) NOT NULL, description TEXT, photo_url TEXT, owner_user_id VARCHAR(255), invite_code VARCHAR(20), member_count INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS group_members (id VARCHAR(255) PRIMARY KEY, group_id VARCHAR(255), profile_id VARCHAR(255), owner_user_id VARCHAR(255), role VARCHAR(50) DEFAULT 'member', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY unique_group_profile (group_id, profile_id))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS chatbox (user_id VARCHAR(255) PRIMARY KEY, display_name VARCHAR(255), last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, is_online TINYINT(1) DEFAULT 1, current_page VARCHAR(255) DEFAULT 'deck')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id VARCHAR(255) PRIMARY KEY, to_user_id VARCHAR(255), from_user_id VARCHAR(255), from_name VARCHAR(255), title VARCHAR(255), body TEXT, type VARCHAR(50) DEFAULT 'chat', is_read TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS direct_messages (id VARCHAR(255) PRIMARY KEY, sender_id VARCHAR(255), sender_name VARCHAR(255), direct_to VARCHAR(255), text TEXT, type VARCHAR(50) DEFAULT 'text', file_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS group_messages (id VARCHAR(255) PRIMARY KEY, sender_id VARCHAR(255), sender_name VARCHAR(255), group_id VARCHAR(255), text TEXT, type VARCHAR(50) DEFAULT 'text', file_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS video_calls (id VARCHAR(255) PRIMARY KEY, caller_id VARCHAR(255), caller_name VARCHAR(255), receiver_id VARCHAR(255), status ENUM('ringing','accepted','rejected','ended') DEFAULT 'ringing', sdp_offer TEXT, sdp_answer TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS profile_relations (id VARCHAR(255) PRIMARY KEY, owner_profile_id VARCHAR(255), related_profile_id VARCHAR(255), relation_type VARCHAR(50), spouse_group VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_owner (owner_profile_id), INDEX idx_related (related_profile_id))`);
    console.log("Tables ready");
  }).catch(err => console.error("DB Failed:", err.message));
}
export const getPool = () => pool;
export const genId = (prefix='') => `${prefix}${Date.now()}_${Math.random().toString(36).substring(2,8)}`;