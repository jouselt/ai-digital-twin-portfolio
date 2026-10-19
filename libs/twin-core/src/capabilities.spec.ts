import {
  browserGpu,
  FALLBACK_MESSAGE,
  probeCapabilities,
  type AdapterLike,
  type GpuLike,
} from './capabilities';

function gpuWith(adapter: AdapterLike | null, throws = false): GpuLike {
  return {
    async requestAdapter() {
      if (throws) throw new Error('adapter request failed');
      return adapter;
    },
  };
}

function adapter(options: {
  vendor?: string;
  architecture?: string;
  features?: readonly string[];
}): AdapterLike {
  return {
    info: { vendor: options.vendor ?? 'amd', architecture: options.architecture ?? 'rdna-2' },
    features:
      options.features === undefined
        ? undefined
        : { has: (name: string) => (options.features as readonly string[]).includes(name) },
  };
}

describe('probeCapabilities', () => {
  it('reports ready on a browser with WebGPU, an adapter and fp16', async () => {
    const capability = await probeCapabilities(
      gpuWith(adapter({ vendor: 'apple', architecture: 'metal-3', features: ['shader-f16'] })),
    );

    expect(capability).toMatchObject({
      canRunModel: true,
      reason: 'ready',
      adapter: { vendor: 'apple', architecture: 'metal-3' },
    });
    expect(capability.message).toBe('');
  });

  it('falls back when the browser has no WebGPU at all', async () => {
    const capability = await probeCapabilities(null);

    expect(capability.canRunModel).toBe(false);
    expect(capability.reason).toBe('no-webgpu');
    expect(capability.message).toBe(FALLBACK_MESSAGE);
  });

  it('falls back when WebGPU exists but no adapter is available', async () => {
    const capability = await probeCapabilities(gpuWith(null));

    expect(capability).toMatchObject({ canRunModel: false, reason: 'no-adapter' });
  });

  it('refuses a GPU without fp16 shaders, naming the real reason', async () => {
    const capability = await probeCapabilities(
      gpuWith(adapter({ vendor: 'intel', features: ['bgra8unorm-storage'] })),
    );

    expect(capability.canRunModel).toBe(false);
    expect(capability.reason).toBe('no-shader-f16');
    expect(capability.adapter).toEqual({ vendor: 'intel', architecture: 'rdna-2' });
    expect(capability.message).toContain('fp16');
  });

  it('treats a throwing adapter request as a fallback, not a crash', async () => {
    const capability = await probeCapabilities(gpuWith(null, true));

    expect(capability).toMatchObject({ canRunModel: false, reason: 'probe-failed' });
  });

  it('assumes fp16 when the adapter does not expose a feature list', async () => {
    const capability = await probeCapabilities(gpuWith(adapter({ features: undefined })));

    expect(capability.canRunModel).toBe(true);
  });
});

describe('browserGpu', () => {
  const scope = globalThis as { navigator?: { gpu?: unknown } };
  const original = scope.navigator;

  afterEach(() => {
    if (original === undefined) {
      delete scope.navigator;
    } else {
      scope.navigator = original as { gpu?: unknown };
    }
  });

  it('returns null instead of throwing when navigator.gpu is absent', () => {
    scope.navigator = {};
    expect(browserGpu()).toBeNull();
  });

  it('returns the gpu object when the browser exposes one', () => {
    const gpu = gpuWith(adapter({ features: ['shader-f16'] }));
    scope.navigator = { gpu };

    expect(browserGpu()).toBe(gpu);
  });
});
