import { useEffect, useRef } from "react";
import { makeRenderer } from "./scene/art";
import { timeWeights } from "./scene/time";

export function SceneCanvas({
  scene,
  minute,
}: {
  scene: string;
  minute: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const render = makeRenderer(node);
    const weights = timeWeights(minute);
    const selectedTime = weights.indexOf(Math.max(...weights));
    const reduce =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let phase = 0.22;
    let last = 0;
    let frame = 0;

    const draw = (now: number): void => {
      frame = requestAnimationFrame(draw);
      if (now - last < 66) return;
      const delta = last ? now - last : 66;
      last = now;
      phase = (phase + delta / 9000) % 1;
      render(scene, weights, phase, selectedTime);
    };

    if (reduce) {
      render(scene, weights, phase, selectedTime);
      return;
    }

    frame = requestAnimationFrame(draw);
    const visibility = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        last = 0;
        frame = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [scene, minute]);

  return (
    <canvas
      ref={canvas}
      width={880}
      height={440}
      className="tg-landscape-art"
      aria-hidden="true"
    />
  );
}