import { describe, expect, it, vi } from 'vitest';

import { GoogleMapsLinkResolver } from './GoogleMapsLinkResolver.js';

type MockFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

describe('GoogleMapsLinkResolver', () => {
  it('resolves a short share URL through manually checked Google redirects', async () => {
    const fetcher = vi.fn<MockFetcher>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: {
          location: 'https://www.google.com/maps/place/example/@-11.9737806,-77.0806044,19z/data=!3d-11.9740702!4d-77.0814464',
        },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example'))
      .resolves.toEqual({ latitude: -11.9740702, longitude: -77.0814464 });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname))
      .toEqual(['maps.app.goo.gl', 'www.google.com']);
    expect(fetcher.mock.calls.every(([, options]) => options?.redirect === 'manual')).toBe(true);
  });

  it('uses place coordinates instead of the map viewport coordinates', async () => {
    const fetcher = vi.fn<MockFetcher>();
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve(
      'https://www.google.com/maps/place/example/@-11.9737806,-77.0806044,19z/data=!3d-11.9740702!4d-77.0814464',
    )).resolves.toEqual({ latitude: -11.9740702, longitude: -77.0814464 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'http://maps.app.goo.gl/example',
    'https://maps.app.goo.gl.evil.example/example',
    'https://127.0.0.1/maps?q=1,2',
    'https://www.google.com/search?q=1,2',
    'https://www.google.com/maps-evil?q=1,2',
  ])('rejects unsupported input URL %s without making a request', async (url) => {
    const fetcher = vi.fn<MockFetcher>();
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve(url)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a redirect to a non-Google host before requesting it', async () => {
    const fetcher = vi.fn<MockFetcher>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a Google Maps result that does not contain coordinates', async () => {
    const fetcher = vi.fn<MockFetcher>().mockResolvedValue(new Response(null, { status: 200 }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example')).rejects.toThrow();
  });

  it('stops after the redirect limit instead of following an unbounded chain', async () => {
    const fetcher = vi.fn<MockFetcher>().mockImplementation(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://www.google.com/maps/next' },
    }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});
