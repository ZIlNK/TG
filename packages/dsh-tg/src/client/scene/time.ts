// Times in art.js are 06:00, 12:00, 18:00 and 00:00. Interpolating between
// neighbouring anchors keeps the light continuous instead of snapping at noon.
const anchors = [6, 12, 18, 24];

export function timeWeights(minute: number): number[] {
  const hour = ((((minute % 1440) + 1440) % 1440) / 60) % 24;
  const raw = anchors.map((anchor) => {
    const direct = Math.abs(hour - (anchor % 24));
    const distance = Math.min(direct, 24 - direct);
    return Math.max(0, 1 - distance / 6);
  });
  const total = raw.reduce((sum, weight) => sum + weight, 0) || 1;
  return raw.map((weight) => weight / total);
}