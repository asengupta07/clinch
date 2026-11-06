import { MeshGradient } from "@paper-design/shaders-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Circle, FilmGrain, FlowingGradient, Godrays, Shader, SolidColor, getWebGPUSupport } from "shaders/react";

const INK = "#070908";

/**
 * Hero background. WebGPU (shaders) first: a slow silk gradient in the green/amber palette with
 * warm light rising from below (the price climbing), masked to the right so the headline stays
 * clean, finished with film grain. Browsers without WebGPU get Paper Shaders' WebGL mesh gradient
 * in the same palette. Both fade in only once their first frame is ready.
 */
export function HeroShader() {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<"checking" | "webgpu" | "webgl">("checking");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    getWebGPUSupport()
      .then(({ supported }) => live && setMode(supported ? "webgpu" : "webgl"))
      .catch(() => live && setMode("webgl"));
    return () => {
      live = false;
    };
  }, []);

  // Paper Shaders has no ready event; reveal after the first couple of frames.
  useEffect(() => {
    if (mode !== "webgl") return;
    let a = 0;
    let b = 0;
    a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setReady(true))));
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [mode]);

  const speed = reduced ? 0 : 1;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {mode === "webgpu" && (
        <Shader
          className="absolute inset-0 size-full"
          style={{ opacity: ready ? 1 : 0, transition: "opacity 1.6s cubic-bezier(0.32,0.72,0,1)" }}
          onReady={() => setReady(true)}
          onUnavailable={() => {
            setReady(false);
            setMode("webgl");
          }}
        >
          <SolidColor color={INK} />
          <Circle id="heroMask" visible={false} color="#ffffff" radius={1.25} softness={1} center={{ x: 0.86, y: 0.58 }} />
          <FlowingGradient
            colorA={INK}
            colorB="#0b2e22"
            colorC="#1c6a4c"
            colorD="#b98a4d"
            colorSpace="oklch"
            speed={0.16 * speed}
            distortion={0.6}
            seed={11}
            maskSource="heroMask"
          />
          <Godrays
            center={{ x: 0.74, y: 1.08 }}
            rayColor="#e6b36d"
            density={0.22}
            intensity={0.28}
            spotty={0.35}
            speed={0.12 * speed}
            blendMode="screen"
            maskSource="heroMask"
          />
          <FilmGrain strength={0.05} bias={2.4} />
        </Shader>
      )}
      {mode === "webgl" && (
        <div
          className="absolute inset-0"
          style={{
            opacity: ready ? 1 : 0,
            transition: "opacity 1.6s cubic-bezier(0.32,0.72,0,1)",
            maskImage: "radial-gradient(120% 110% at 88% 60%, #000 30%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(120% 110% at 88% 60%, #000 30%, transparent 78%)",
          }}
        >
          <MeshGradient
            className="size-full"
            style={{ width: "100%", height: "100%" }}
            colors={[INK, "#0b2e22", "#1c6a4c", "#b98a4d"]}
            distortion={0.75}
            swirl={0.12}
            grainOverlay={0.08}
            speed={0.14 * speed}
          />
        </div>
      )}
      {/* soft floor so the hero melts into the page */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[var(--l-bg)]" />
    </div>
  );
}
