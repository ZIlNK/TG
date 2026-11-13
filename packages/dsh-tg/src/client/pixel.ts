// Pure version of src/scripts/pixel-images.js: retain its seeded palette and tiles.
// SVG is assembled without SugarCube or DOM access; labels are XML-escaped.
export function pixelImage(name: string): string {
  let hash = 0;
  for (const char of name) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  let seed = Math.abs(hash);
  const random = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const hue = Math.floor(random() * 360),
    saturation = 40 + Math.floor(random() * 40),
    light = 20 + Math.floor(random() * 40);
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120" shape-rendering="crispEdges"><rect width="160" height="120" fill="#111"/>',
  ];
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 20; x++)
      if (random() > 0.4) {
        const h = (hue + Math.floor(random() * 60)) % 360,
          s = Math.min(100, saturation + Math.floor(random() * 30)),
          l = Math.max(
            10,
            Math.min(90, light + Math.floor(random() * 40 - 20)),
          );
        parts.push(
          `<rect x="${x * 8}" y="${y * 8}" width="8" height="8" fill="hsl(${h},${s}%,${l}%)"/>`,
        );
      }
  const escaped = name.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
  parts.push(
    `<text x="80" y="112" text-anchor="middle" fill="rgba(255,255,255,.5)" font-family="monospace" font-size="10">${escaped}</text></svg>`,
  );
  return "data:image/svg+xml," + encodeURIComponent(parts.join(""));
}
