// Paint from the card's existing frame, so crop, pause, seeking and export agree.
export function createCardGlassTitle(info, name) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  info.append(canvas);
  const brush = () => document.createElement('canvas').getContext('2d');
  const mask = brush(), outline = brush(), light = brush();
  const ctx = canvas.getContext('2d');
  const graphemes = new Intl.Segmenter(undefined, {granularity:'grapheme'});
  let metrics;

  function prepare(width, height, text, ratio) {
    for (const layer of [ctx, mask, outline, light]) {
      layer.canvas.width = Math.round(width * ratio);
      layer.canvas.height = Math.round(height * ratio);
    }
    const style = getComputedStyle(name);
    const maxWidth = width - 44;
    const x = 22, y = height - 21;
    for (const layer of [mask, outline]) {
      layer.setTransform(ratio, 0, 0, ratio, 0, 0);
      layer.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      layer.letterSpacing = style.letterSpacing;
      layer.textBaseline = 'ideographic';
    }
    let label = text;
    if (mask.measureText(label).width > maxWidth) {
      const segments = Array.from(graphemes.segment(text), item => item.segment);
      do {
        segments.pop();
        label = `${segments.join('')}…`;
      } while (segments.length && mask.measureText(label).width > maxWidth);
    }
    mask.fillText(label, x, y);
    outline.lineJoin = 'round';
    outline.lineWidth = 3.2;
    outline.strokeStyle = '#101925e8';
    outline.strokeText(label, x, y);

    light.drawImage(mask.canvas, 0, 0);
    light.globalCompositeOperation = 'destination-out';
    light.drawImage(mask.canvas, ratio * 1.05, ratio * 1.35);
    light.globalCompositeOperation = 'source-in';
    light.fillStyle = '#f4fcffe0';
    light.fillRect(0, 0, light.canvas.width, light.canvas.height);

    const textWidth = mask.measureText(label).width;
    metrics = { width, height, text, ratio, centerX:x + textWidth / 2 };
  }

  return (frame, cardWidth, cardHeight) => {
    const text = name.textContent;
    const height = info.clientHeight;
    if (!text || !height) return;
    const ratio = Math.max(1, frame.width / cardWidth);
    if (metrics?.text !== text || metrics.ratio !== ratio || metrics.width !== cardWidth || metrics.height !== height) {
      prepare(cardWidth, height, text, ratio);
    }
    const width = canvas.width, pixelsHigh = canvas.height;
    const zoom = 1.075;
    const zoomX = (4 - metrics.centerX * (zoom - 1)) * ratio;
    const zoomY = (10 - (cardHeight - 25) * (zoom - 1) - (cardHeight - height)) * ratio;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, pixelsHigh);
    ctx.drawImage(frame, zoomX, zoomY, width * zoom, cardHeight * ratio * zoom);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask.canvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(outline.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(light.canvas, 0, 0);
    info.classList.add('glass-ready');
  };
}
