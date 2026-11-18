CREATE TABLE IF NOT EXISTS whatsapp_feedback (
  message_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  sender VARCHAR(32) NOT NULL,
  message TEXT CHARACTER SET utf8mb4 NOT NULL,
  reply_to VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX feedback_inbox (received_at, message_id)
) ENGINE=InnoDB;
