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
