CREATE TABLE IF NOT EXISTS product_categories (
  name VARCHAR(40) PRIMARY KEY
) ENGINE=InnoDB;

INSERT IGNORE INTO product_categories (name)
SELECT DISTINCT category FROM products;
