import { Network, type NetworkSpec } from "./network";

/**
 * Modelldatei: versioniert, mit Herkunft (Elternmodell, Algorithmus,
 * Trainingskonfiguration, Seed) und Evaluationsergebnissen.
 * Gewichte als Float32 (Base64) — dieselbe Datei wird im Training (Node),
 * im Browser-Training und im Spiel geladen.
 */
export type ModelFile = {
  format: "lhitl-aurora/1";
  id: string;
  parent: string | null;
  algorithm: string;
  spec: NetworkSpec;
  /** Trainingskonfiguration inkl. Seed — reicht zur Reproduktion. */
  training: Record<string, unknown>;
  /** Insgesamt gespielte Trainingspartien (inkl. Vorfahren). */
  episodes: number;
  paramsHash: string;
  params: string;
  metrics?: Record<string, unknown>;
  notes?: string;
};

export function toFloat32(params: Float64Array): Float64Array {
  return Float64Array.from(Float32Array.from(params));
}

export function encodeParams(params: Float64Array): string {
  const bytes = new Uint8Array(Float32Array.from(params).buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decodeParams(encoded: string): Float64Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Float64Array.from(new Float32Array(bytes.buffer));
}

/** FNV-1a über die Float32-Bytes: erkennt veränderte oder vertauschte Gewichte. */
export function hashParams(params: Float64Array): string {
  const bytes = new Uint8Array(Float32Array.from(params).buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function createModelFile(
  net: Network,
  meta: Omit<ModelFile, "format" | "spec" | "params" | "paramsHash">,
): ModelFile {
  return {
    format: "lhitl-aurora/1",
    ...meta,
    spec: net.spec,
    paramsHash: hashParams(net.params),
    params: encodeParams(net.params),
  };
}

export function loadNetwork(file: ModelFile): Network {
  if (file.format !== "lhitl-aurora/1") throw new Error(`Unbekanntes Modellformat: ${file.format}`);
  const params = decodeParams(file.params);
  if (hashParams(params) !== file.paramsHash) throw new Error(`Prüfsumme von ${file.id} stimmt nicht`);
  return new Network(file.spec, params);
}
