import { Notice } from './notice.jsx';
import React, { useEffect, useState } from 'react';

function readImage(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image no larger than 5 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

export function stockLabel(stock) {
  if (stock == null) return 'Stock untracked';
  return stock === 0 ? 'Out of stock' : `${stock} in stock`;
}

export function ProductManager({ api, refreshRegister, money }) {
  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setError('');
    try {
      const catalog = await api('/api/products');
      setProducts(catalog.products);
      setCategories(catalog.categories);
    } catch (failure) {
      setError(failure.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function addCategory(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get('name');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/api/categories', { name });
      form.reset();
      setMessage('Category added.');
      await load();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    const { photo, ...values } = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      await api('/api/products', {
        ...values,
        image: editing.image,
        imageData: photo?.name ? await readImage(photo) : undefined,
        id: editing.id,
        previousStock: editing.stock,
        price: Math.round(Number(values.price) * 100),
        stock: values.stock === '' ? null : Number(values.stock),
        active: values.active === 'on',
      });
      setEditing(null);
      setMessage(editing.id ? 'Product updated.' : 'Product added.');
      await Promise.all([load(), refreshRegister()]);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <Notice>{error}</Notice>}
      {editing ? (
        <form onSubmit={save}>
          <h3>{editing.id ? 'Edit product' : 'Add product'}</h3>
          <fieldset className="product-fields" disabled={busy}>
            <label className="field">
              Name
              <input name="name" required maxLength={120} defaultValue={editing.name} />
            </label>
            <label className="field">
              Product code
              <input name="code" required maxLength={64} defaultValue={editing.code} />
            </label>
            <label className="field">
              Category
              <select name="category" required defaultValue={editing.category ?? ''}>
                <option value="" disabled>
                  Select a category
                </option>
                {editing.category && !categories.includes(editing.category) && (
                  <option>{editing.category}</option>
                )}
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Price (₹)
              <input
                name="price"
                type="number"
                min="0"
                max="42949672.95"
                step="0.01"
                required
                defaultValue={editing.price == null ? '' : editing.price / 100}
              />
            </label>
            <label className="field">
              Units in stock
              <input
                name="stock"
                type="number"
                min="0"
                max="4294967295"
                step="1"
                placeholder="Leave blank to skip tracking"
                defaultValue={editing.id ? (editing.stock ?? '') : 0}
              />
            </label>
            <label className="field product-description">
              Product image
              {editing.image && (
                <img
                  className="product-image-preview"
                  src={editing.image}
                  alt="Current product image"
                />
              )}
              <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
              <small>JPEG, PNG, or WebP up to 5 MB</small>
            </label>
            <label className="field product-description">
              Description
              <input name="description" maxLength={255} defaultValue={editing.description} />
            </label>
            <label className="check">
              <input name="active" type="checkbox" defaultChecked={editing.active ?? true} /> Show
              on register
            </label>
          </fieldset>
          <div className="actions">
            <button
              type="button"
              className="method"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                load();
              }}
            >
              Back to list
            </button>
            <button className="checkout" disabled={busy}>
              {busy ? 'Saving…' : 'Save product'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            className="scan"
            disabled={busy || !categories.length}
            onClick={() => {
              setError('');
              setMessage('');
              setEditing({});
            }}
          >
            Add product
          </button>
          <Notice kind="success">{message}</Notice>
          <details className="samples category-manager">
            <summary>Manage categories</summary>
            {categories.length > 0 && <p>{categories.join(' · ')}</p>}
            <form onSubmit={addCategory}>
              <label className="field">
                New category
                <input name="name" required maxLength={40} disabled={busy} />
              </label>
              <button className="scan" disabled={busy}>
                Add category
              </button>
            </form>
          </details>
          {!products &&
            (error ? (
              <button className="method" onClick={load}>
                Retry
              </button>
            ) : (
              <p role="status">Loading products…</p>
            ))}
          {products?.length === 0 && <p>No products yet.</p>}
          <ul className="product-list">
            {products?.map((product) => (
              <li className="split" key={product.id}>
                <div>
                  <strong>{product.name}</strong>
                  <br />
                  <small>
                    {product.code} · {money(product.price)} · {stockLabel(product.stock)}
                    {!product.active && ' · Hidden'}
                  </small>
                </div>
                <button
                  className="method"
                  disabled={busy}
                  aria-label={`Edit ${product.name}`}
                  onClick={() => {
                    setError('');
                    setMessage('');
                    setEditing(product);
                  }}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
