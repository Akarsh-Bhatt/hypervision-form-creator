export interface ScaleConfig {
  min: number;
  max: number;
  format: "numeric" | "stars";
  minLabel: string;
  maxLabel: string;
}

export function parseScaleConfig(options?: string[]): ScaleConfig {
  const min =
    options?.[0] !== undefined && !isNaN(Number(options[0]))
      ? Number(options[0])
      : 1;

  const max =
    options?.[1] !== undefined && !isNaN(Number(options[1]))
      ? Number(options[1])
      : 5;

  const format: "numeric" | "stars" =
    options?.[2] === "stars" ? "stars" : "numeric";

  const minLabel = options?.[3] || "";
  const maxLabel = options?.[4] || "";

  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
    format,
    minLabel,
    maxLabel,
  };
}

export function serializeScaleConfig(config: Partial<ScaleConfig>, current?: ScaleConfig): string[] {
  const base = current || {
    min: 1,
    max: 5,
    format: "numeric",
    minLabel: "",
    maxLabel: "",
  };

  const next = { ...base, ...config };
  return [
    String(next.min),
    String(next.max),
    next.format,
    next.minLabel || "",
    next.maxLabel || "",
  ];
}

