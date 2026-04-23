import QRCode from 'qrcode';

export function renderQrMatrix(url: string): string[] {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'L' });
  const size = qr.modules.size;
  const data = qr.modules.data;

  const quiet = 1;
  const total = size + quiet * 2;

  // Build padded boolean matrix (true = dark)
  const matrix: boolean[][] = Array.from({ length: total }, (_, r) =>
    Array.from({ length: total }, (_, c) => {
      if (r < quiet || r >= size + quiet || c < quiet || c >= size + quiet) {
        return false;
      }
      return data[(r - quiet) * size + (c - quiet)] === 1;
    }),
  );

  // Render 2 matrix rows per text line using Unicode half-blocks
  const lines: string[] = [];
  for (let r = 0; r < total; r += 2) {
    let line = '';
    for (let c = 0; c < total; c++) {
      const top = matrix[r][c];
      const bottom = r + 1 < total ? matrix[r + 1][c] : false;
      if (top && bottom) line += '█';
      else if (top) line += '▀';
      else if (bottom) line += '▄';
      else line += ' ';
    }
    lines.push(line);
  }
  return lines;
}
