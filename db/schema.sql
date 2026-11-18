CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(40) NOT NULL,
  description VARCHAR(255) NOT NULL,
  price_paise INT UNSIGNED NOT NULL,
  image VARCHAR(120) NOT NULL,
  stock INT UNSIGNED NULL DEFAULT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_barcodes (
  barcode VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales (
  request_id CHAR(36) NOT NULL PRIMARY KEY,
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  request_hash CHAR(64) NOT NULL,
  order_type ENUM('Dine-in','Takeaway') NOT NULL,
  payment ENUM('Cash','Card','UPI') NOT NULL,
  total_paise INT UNSIGNED NOT NULL,
  canceled_at TIMESTAMP(3) NULL DEFAULT NULL,
  cancel_reason VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sale_items (
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  stock_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  price_paise INT UNSIGNED NOT NULL,
  PRIMARY KEY (sale_id, product_id),
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS review_jobs (
  sale_id BIGINT UNSIGNED PRIMARY KEY,
  phone VARCHAR(16) NULL,
  status ENUM('queued','sending','accepted','failed','unknown') NOT NULL DEFAULT 'queued',
  provider_id VARCHAR(255) NULL,
  failure VARCHAR(140) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX job_queue (status, sale_id),
  FOREIGN KEY (sale_id) REFERENCES sales(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO products (id,code,name,category,description,price_paise,image) VALUES
  (1,'DS101','Classic Kunafa','Kunafa','Golden kataifi, soft cheese and pistachio',24900,'/dish-0.webp'),
  (2,'DS102','Chocolate Kunafa','Kunafa','Crisp kataifi with dark chocolate',28900,'/dish-1.webp'),
  (3,'DS103','Pistachio Mafroukeh','Chilled','Pistachio semolina and clotted cream',22900,'/dish-2.webp'),
  (4,'DS104','Berry Laban','Chilled','Chilled milk pudding and raspberry',17900,'/dish-3.webp'),
  (5,'DS105','Pistachio Baklava','Pastries','Buttery filo, pistachios and syrup',19900,'/dish-4.webp'),
  (6,'DS106','Arabic Coffee','Drinks','Cardamom coffee served with dates',11900,'/dish-5.webp');
CREATE TABLE IF NOT EXISTS whatsapp_feedback (
  message_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  sender VARCHAR(32) NOT NULL,
  message TEXT CHARACTER SET utf8mb4 NOT NULL,
  reply_to VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX feedback_inbox (received_at, message_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS product_categories (
  name VARCHAR(40) PRIMARY KEY
) ENGINE=InnoDB;

INSERT IGNORE INTO product_categories (name)
SELECT DISTINCT category FROM products;
CREATE TABLE IF NOT EXISTS sale_item_cancellations (
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  request_id CHAR(36) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (sale_id, request_id),
  FOREIGN KEY (sale_id, product_id) REFERENCES sale_items(sale_id, product_id)
) ENGINE=InnoDB;
