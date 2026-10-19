/**
 * What the visitor's browser can do, decided before anything is downloaded.
 *
 * The point of this module is that the product never depends on one machine: the
 * answer to "can this browser run the model?" is computed from the browser in
 * front of us, and every answer has a defined path. It takes its inputs as
 * arguments so the whole matrix is testable in Jest with no GPU and no browser.
 */

export type CapabilityReason =
  | 'ready'
  | 'no-webgpu'
  | 'no-adapter'
  | 'no-shader-f16'
  | 'probe-failed';

export interface Capability {
  readonly canRunModel: boolean;
  readonly reason: CapabilityReason;
  /** Vendor and architecture reported by the adapter, for the trace panel. */
  readonly adapter: { readonly vendor: string; readonly architecture: string } | null;
  /** Shown to the visitor when the model cannot run, instead of a silent failure. */
  readonly message: string;
}

/** The subset of the WebGPU surface this module reads, so a fake is trivial. */
export interface GpuLike {
  requestAdapter(options?: { powerPreference?: string }): Promise<AdapterLike | null>;
  getPreferredCanvasFormat?(): string;
}

export interface AdapterLike {
  readonly info?: { readonly vendor?: string; readonly architecture?: string; readonly description?: string };
  readonly features?: { has(name: string): boolean };
}

export const FALLBACK_MESSAGE =
  'This browser cannot run the model locally, so answers come from a pre-built set of ' +
  'responses. Open the site in a recent Chrome, Edge or Safari to run the model on your ' +
  'own machine.';

/**
 * Checks, in order: WebGPU present, adapter available, and fp16 shaders.
 *
 * fp16 is checked because the small quantised models are compiled for it; a GPU
 * that exposes WebGPU without shader-f16 loads, then fails on the first token,
 * which looks like a bug in the app rather than a hardware limit.
 */
export async function probeCapabilities(gpu: GpuLike | undefined | null): Promise<Capability> {
  if (gpu === undefined || gpu === null) {
    return {
      canRunModel: false,
      reason: 'no-webgpu',
      adapter: null,
      message: FALLBACK_MESSAGE,
    };
  }

  let adapter: AdapterLike | null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return { canRunModel: false, reason: 'probe-failed', adapter: null, message: FALLBACK_MESSAGE };
  }

  if (adapter === null) {
    return {
      canRunModel: false,
      reason: 'no-adapter',
      adapter: null,
      message: FALLBACK_MESSAGE,
    };
  }

  const info = {
    vendor: adapter.info?.vendor ?? 'unknown',
    architecture: adapter.info?.architecture ?? 'unknown',
  };

  if (adapter.features !== undefined && !adapter.features.has('shader-f16')) {
    return {
      canRunModel: false,
      reason: 'no-shader-f16',
      adapter: info,
      message:
        'This GPU supports WebGPU but not fp16 shaders, which the small quantised models ' +
        'need. Answers come from a pre-built set of responses instead.',
    };
  }

  return { canRunModel: true, reason: 'ready', adapter: info, message: '' };
}

/** Reads `navigator.gpu` without assuming the global exists. */
export function browserGpu(): GpuLike | null {
  const nav = globalThis as { navigator?: { gpu?: GpuLike } };
  return nav.navigator?.gpu ?? null;
}
