import { InputError } from './sales.js';

export const productColumns = 'id,code,name,category,description,price_paise AS price,image,stock,active';

export async function saveProduct(pool, body) {
  const { id, price, stock, previousStock, active } = body ?? {};
  const fields = ['code', 'name', 'category', 'description', 'image'];
  const [rawCode, name, category, description, imagePath] = fields.map(
    field => typeof body?.[field] === 'string' ? body[field].trim() : '');
  const code = rawCode.toUpperCase();
  const image = imagePath || '/shop.webp';
  const uint = value => Number.isInteger(value) && value >= 0 && value <= 4294967295;
  const validStock = value => value === null || uint(value);
  if (!/^[ -~]{1,64}$/.test(code) || !name || name.length > 120 ||
      !category || category.length > 40 || description.length > 255 ||
      !/^\/[a-z0-9_./-]+\.(webp|png|jpe?g|avif)$/i.test(image) ||
      image.startsWith('//') || image.includes('..') || image.length > 120 ||
      !uint(price) || !validStock(stock) || typeof active !== 'boolean' ||
      (id !== undefined && (!uint(id) || id === 0 || !validStock(previousStock)))) {
    throw new InputError('Check the product details, price, image path and stock quantity.');
  }
  const [[linked]] = await pool.execute('SELECT product_id FROM product_barcodes WHERE barcode=?', [code]);
  if (linked && linked.product_id !== id) {
    throw new InputError('This code is already linked to another product.', 409);
  }
  const values = [code, name, category, description, price, image, active];
  try {
    if (id === undefined) {
      const [result] = await pool.execute(
        'INSERT INTO products (code,name,category,description,price_paise,image,active,stock) VALUES (?,?,?,?,?,?,?,?)',
        [...values, stock]);
      return result.insertId;
    }
    const stockChanged = stock !== previousStock;
    const [result] = await pool.execute(
      `UPDATE products SET code=?,name=?,category=?,description=?,price_paise=?,image=?,active=?,
        stock=IF(?, ?, stock) WHERE id=? AND (NOT ? OR stock <=> ?)`,
      [...values, stockChanged, stock, id, stockChanged, previousStock]);
    if (!result.affectedRows) throw new InputError('Stock changed or the product was removed. Reload the product and try again.', 409);
    return id;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new InputError('This product code is already in use.', 409);
    throw error;
  }
}
