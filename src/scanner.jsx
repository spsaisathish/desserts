import React, { useEffect, useRef, useState } from 'react';

const formats = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'];

async function createDetector() {
  try {
    if ('BarcodeDetector' in window) {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const enabled = formats.filter(format => supported.includes(format));
      if (enabled.length === formats.length) return new window.BarcodeDetector({ formats: enabled });
    }
  } catch {
    // The bundled decoder can cover devices where the native API is unavailable.
  }
  const [{ BrowserMultiFormatReader }, { NotFoundException, ChecksumException, FormatException }] =
    await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const reader = new BrowserMultiFormatReader();
  return { async detect(video) {
    if (video.readyState < 2) return [];
    try {
      return [{ rawValue: reader.decode(video).getText() }];
    } catch (error) {
      if ([NotFoundException, ChecksumException, FormatException].some(type => error instanceof type)) return [];
      throw error;
    }
  } };
}

export function Scanner({ scan, products }) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [camera, setCamera] = useState(false);
  const input = useRef(null);
  const video = useRef(null);
  const onScan = useRef(scan);
  onScan.current = scan;

  function scanned(value) {
    const product = onScan.current(value);
    setMessage(product ? `Added ${product.name}` : `Unable to add code ${value}. Check the product code or order quantity.`);
  }

  useEffect(() => {
    if (!camera) return;
    const target = video.current;
    let cancelled = false;
    let stream;
    let timer;
    let previous = '';
    let blankFrames = 0;

    async function read(detector) {
      if (cancelled) return;
      try {
        const [match] = await detector.detect(target);
        if (cancelled) return;
        if (match) {
          blankFrames = 0;
          if (match.rawValue !== previous) scanned(match.rawValue);
          previous = match.rawValue;
        } else if (++blankFrames >= 3) previous = '';
        timer = setTimeout(() => read(detector), 180);
      } catch {
        if (!cancelled) {
          setMessage('Camera scanning stopped. Restart the camera or enter a code.');
          setCamera(false);
        }
      }
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open this register over HTTPS to use the camera.');
        const detector = await createDetector();
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        target.srcObject = stream;
        await target.play();
        if (!cancelled) read(detector);
      } catch (error) {
        if (!cancelled) {
          setMessage(error.name === 'NotAllowedError' ? 'Allow camera access in the browser, or enter a code.' : error.message);
          setCamera(false);
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      target.srcObject = null;
    };
  }, [camera]);

  return <>
    <p className="help">Show a QR code or barcode to the camera. It adds the product automatically. Move the code away before scanning the same item again.</p>
    <button type="button" className="scan" onClick={() => { setMessage(''); setCamera(!camera); }}>{camera ? 'Stop camera' : 'Start camera'}</button>
    <video className="viewfinder" ref={video} hidden={!camera} playsInline muted />
    <form className="scan-form" onSubmit={event => {
      event.preventDefault();
      if (code.trim()) scanned(code.trim());
      setCode('');
      input.current.focus();
    }}>
      <input autoFocus ref={input} aria-label="Product code" placeholder="Type or scan a product code" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} />
      <button className="scan">Add item</button>
    </form>
    <p className="scan-message" role="status">{message}</p>
    <details className="samples"><summary>Sample product QR codes</summary>
      <div className="sample-grid">{products.filter(product => /^DS10[1-6]$/.test(product.code)).map(product =>
        <button className="sample" type="button" key={product.id} onClick={() => { setCode(product.code); input.current.focus(); }}>
          <img alt="" src={`/qr-${Number(product.code.slice(-1)) - 1}.png`} /><span>{product.name}</span><b>{product.code}</b>
        </button>)}</div>
    </details>
  </>;
}
