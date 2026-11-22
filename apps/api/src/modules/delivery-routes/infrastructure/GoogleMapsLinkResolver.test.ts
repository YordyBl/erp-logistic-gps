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

  it('resolves a shared pin whose coordinates are in the path, as Google redirects app share links', async () => {
    const fetcher = vi.fn<MockFetcher>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://www.google.com/maps/search/-11.880929,+-77.030873?entry=tts&g_ep=EgoyMDI2MTExMC4wIPu8ASoASAFQAw==&skid=0d12a275-1e60-4386-bf5b-157b2ef27d7a' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/ajPfPXy4VhR8Ujat8'))
      .resolves.toEqual({ latitude: -11.880929, longitude: -77.030873 });
  });

  it.each([
    ['a path pair with a plus sign', 'https://www.google.com/maps/search/-11.886370,+-77.027094?entry=tts', -11.88637, -77.027094],
    ['a path pair with an encoded comma', 'https://www.google.com/maps/search/-12.0840%2C-77.0350', -12.084, -77.035],
    ['a path pair with an encoded space', 'https://www.google.com/maps/place/-12.0840,%20-77.0350', -12.084, -77.035],
    ['a coordinate query parameter', 'https://www.google.com/maps?ll=-12.0840,-77.0350&z=17', -12.084, -77.035],
  ])('finds coordinates in %s without making a request', async (_case, url, latitude, longitude) => {
    const fetcher = vi.fn<MockFetcher>();

    await expect(new GoogleMapsLinkResolver(fetcher).resolve(url)).resolves.toEqual({ latitude, longitude });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['the Peru Google domain', 'https://www.google.com.pe/maps/place/Lima/@-12.0464,-77.0428,17z', -12.0464, -77.0428],
    ['the Peru maps host at its root', 'https://maps.google.com.pe/?q=-12.0840,-77.0350', -12.084, -77.035],
    ['the maps host at its root', 'https://maps.google.com/?ll=-12.0840,-77.0350&z=16', -12.084, -77.035],
    ['an embedded map, which writes longitude first', 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3901.6!2d-77.035!3d-12.084!2m3!1f0!2f0!3f0', -12.084, -77.035],
    ['degrees, minutes and seconds', "https://www.google.com/maps/place/12%C2%B005'02.4%22S+77%C2%B002'06.0%22W", -12.084, -77.035],
  ])('finds coordinates in %s', async (_case, url, latitude, longitude) => {
    const fetcher = vi.fn<MockFetcher>();

    await expect(new GoogleMapsLinkResolver(fetcher).resolve(url)).resolves.toEqual({ latitude, longitude });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('follows a legacy goo.gl/maps short link but no other goo.gl path', async () => {
    const fetcher = vi.fn<MockFetcher>()
      .mockResolvedValueOnce(new Response(null, {
        status: 301, headers: { location: 'https://maps.app.goo.gl/legacy' },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302, headers: { location: 'https://www.google.com/maps/search/-12.084,+-77.035' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://goo.gl/maps/AbCdEf123')).resolves.toEqual({ latitude: -12.084, longitude: -77.035 });
    await expect(resolver.resolve('https://goo.gl/other')).rejects.toMatchObject({ reason: 'unsupported_host' });
  });

  it('reads the map URL behind a Google consent redirect without requesting the consent page', async () => {
    const fetcher = vi.fn<MockFetcher>().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'https://consent.google.com/m?continue=https://www.google.com/maps/search/-11.880929,%2B-77.030873?entry%3Dtts&gl=PE&hl=es' },
    }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/consent'))
      .resolves.toEqual({ latitude: -11.880929, longitude: -77.030873 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports no coordinates when the URL behind a consent redirect has none, and rejects other continue hosts', async () => {
    const consent = (target: string) => vi.fn<MockFetcher>().mockResolvedValueOnce(new Response(null, {
      status: 302, headers: { location: `https://consent.google.com/m?continue=${encodeURIComponent(target)}` },
    }));

    const noCoordinates = consent('https://www.google.com/maps/place/Lima');
    await expect(new GoogleMapsLinkResolver(noCoordinates).resolve('https://maps.app.goo.gl/a'))
      .rejects.toMatchObject({ reason: 'no_coordinates' });
    expect(noCoordinates).toHaveBeenCalledTimes(1);
    await expect(new GoogleMapsLinkResolver(consent('https://evil.example/maps/@-12.1,-77.1')).resolve('https://maps.app.goo.gl/b'))
      .rejects.toMatchObject({ reason: 'unsupported_host' });
  });

  it('does not take integers from unrelated parameters as coordinates', async () => {
    const fetcher = vi.fn<MockFetcher>().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new GoogleMapsLinkResolver(fetcher).resolve('https://www.google.com/maps/place/Lima?hl=1,2'))
      .rejects.toMatchObject({ reason: 'no_coordinates' });
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

    await expect(resolver.resolve(url)).rejects.toMatchObject({ reason: 'unsupported_host' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports a value that is not a URL as invalid', async () => {
    const resolver = new GoogleMapsLinkResolver(vi.fn<MockFetcher>());

    await expect(resolver.resolve('not a url')).rejects.toMatchObject({ reason: 'invalid_url' });
  });

  it('rejects a redirect to a non-Google host before requesting it', async () => {
    const fetcher = vi.fn<MockFetcher>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example'))
      .rejects.toMatchObject({ reason: 'unsupported_host' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports a short link that does not end on a Google Maps page', async () => {
    const fetcher = vi.fn<MockFetcher>().mockResolvedValue(new Response(null, { status: 200 }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example'))
      .rejects.toMatchObject({ reason: 'not_map_page' });
  });

  it('reports a Google Maps page without coordinates', async () => {
    const fetcher = vi.fn<MockFetcher>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302, headers: { location: 'https://www.google.com/maps/place/Lima' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example'))
      .rejects.toMatchObject({ reason: 'no_coordinates' });
  });

  it('stops after the redirect limit instead of following an unbounded chain', async () => {
    const fetcher = vi.fn<MockFetcher>().mockImplementation(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://www.google.com/maps/next' },
    }));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example'))
      .rejects.toMatchObject({ reason: 'redirect_invalid' });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('reports a network failure as unreachable', async () => {
    const fetcher = vi.fn<MockFetcher>().mockRejectedValue(new TypeError('fetch failed'));
    const resolver = new GoogleMapsLinkResolver(fetcher);

    await expect(resolver.resolve('https://maps.app.goo.gl/example'))
      .rejects.toMatchObject({ reason: 'unreachable' });
  });

  it('reports a request that exceeds the resolution deadline as a timeout', async () => {
    const fetcher = vi.fn<MockFetcher>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const resolver = new GoogleMapsLinkResolver(fetcher, 20);

    await expect(resolver.resolve('https://maps.app.goo.gl/example'))
      .rejects.toMatchObject({ reason: 'timeout' });
  });
});
