export function reduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function animateCartAdd(photo, destination) {
  if (!destination || reduceMotion() || typeof destination.animate !== 'function') return;
  const target = destination.getBoundingClientRect();
  if (!target.width || !target.height) return;

  const highlight = () => {
    if (!destination.isConnected) return;
    destination.animate(
      [{ boxShadow: '0 0 0 0 #c49a53af' }, { boxShadow: '0 0 0 8px #c49a5300' }],
      { duration: 360, easing: 'ease-out' },
    );
  };
  if (!photo?.complete || !photo.naturalWidth) {
    highlight();
    return;
  }

  const source = photo.getBoundingClientRect();
  const startX = source.left + source.width / 2;
  const startY = Math.max(24, Math.min(window.innerHeight - 24, source.top + source.height / 2));
  const dx = target.left + target.width / 2 - startX;
  const dy = target.top + target.height / 2 - startY;
  const image = new Image();
  image.src = photo.currentSrc || photo.src;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.className = 'cart-flying-item';
  image.style.left = `${startX}px`;
  image.style.top = `${startY}px`;
  document.body.append(image);

  const animation = image.animate(
    [
      { transform: 'translate(0, 0) scale(.68)', opacity: 0.85 },
      {
        transform: `translate(${dx * 0.2}px, ${dy * 0.2 - 28}px) scale(1)`,
        opacity: 1,
        offset: 0.32,
      },
      {
        transform: `translate(${dx}px, ${dy}px) scale(.28)`,
        opacity: 0,
      },
    ],
    { duration: 560, easing: 'cubic-bezier(.22, .7, .35, 1)' },
  );
  animation.onfinish = () => {
    image.remove();
    highlight();
  };
  animation.oncancel = () => image.remove();
}

export function animateCartRemove(row, lastUnit) {
  if (!row || reduceMotion() || typeof row.animate !== 'function') return;
  if (!lastUnit) {
    row.querySelector('.qty span')?.animate(
      [
        { transform: 'translateY(-4px) scale(.82)', opacity: 0.55 },
        { transform: 'translateY(1px) scale(1.17)', opacity: 1, offset: 0.62 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      { duration: 240, easing: 'ease-out' },
    );
    return;
  }

  const { left, top, width, height } = row.getBoundingClientRect();
  if (!width || !height) return;
  const copy = row.cloneNode(true);
  copy.classList.add('cart-exiting-item');
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  Object.assign(copy.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  document.body.append(copy);
  const animation = copy.animate(
    [
      { opacity: 1, transform: 'translateX(0) scale(1)' },
      { opacity: 0, transform: 'translateX(32px) scale(.94)' },
    ],
    { duration: 300, easing: 'cubic-bezier(.2, .65, .34, 1)' },
  );
  animation.onfinish = animation.oncancel = () => copy.remove();
}
