-- Run this ONCE in MySQL Workbench if you already imported database.sql before this update.
USE campus_fault_db;
ALTER TABLE users ADD COLUMN username VARCHAR(40) NULL UNIQUE AFTER name;
ALTER TABLE reports ADD COLUMN assigned_staff_id INT UNSIGNED NULL AFTER user_id;
ALTER TABLE reports ADD CONSTRAINT fk_reports_assigned_staff FOREIGN KEY (assigned_staff_id) REFERENCES users(id) ON DELETE SET NULL;
-- If an ALTER statement says the column/constraint already exists, skip only that statement.
