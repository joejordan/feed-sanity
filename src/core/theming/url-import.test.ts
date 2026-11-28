import { describe, expect, it, vi } from 'vitest';
import { MAX_THEME_FILE_BYTES } from './document';
import {
  fetchThemeTextFromUrl,
  MAX_THEME_IMPORT_URL_LENGTH,
  validateThemeImportUrl,
} from './url-import';

describe('validateThemeImportUrl', () => {
  it('accepts public HTTPS URLs and strips fragments', () => {
    expect(
      validateThemeImportUrl(
        '  https://raw.githubusercontent.com/user/repo/main/a.fstheme.json#v1 ',
      ),
    ).toEqual({
      ok: true,
      url: 'https://raw.githubusercontent.com/user/repo/main/a.fstheme.json',
      displayHost: 'raw.githubusercontent.com',
    });
  });

  it('rejects empty, non-HTTPS, credentialed, whitespace, and oversized URLs', () => {
    expect(validateThemeImportUrl('   ').ok).toBe(false);
    expect(validateThemeImportUrl('http://example.com/theme.fstheme.json')).toEqual({
      ok: false,
      error: 'Theme URLs must use https://.',
    });
    expect(validateThemeImportUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateThemeImportUrl('data:application/json,{}').ok).toBe(false);
    expect(validateThemeImportUrl('https://user:pass@example.com/a.json')).toEqual({
      ok: false,
      error: 'Theme URLs must not include embedded credentials.',
    });
    expect(validateThemeImportUrl('https://example.com/a b.json').ok).toBe(false);
    expect(
      validateThemeImportUrl(`https://example.com/${'a'.repeat(MAX_THEME_IMPORT_URL_LENGTH)}`).ok,
    ).toBe(false);
  });

  it('blocks localhost, local suffixes, single-label hosts, and private/metadata IPv4 & IPv6 addresses', () => {
    const blocked = [
      'https://localhost/theme.json',
      'https://sub.localhost/theme.json',
      'https://printer.local/theme.json',
      'https://corp.internal/theme.json',
      'https://intranet/theme.json',
      'https://127.0.0.1/theme.json',
      'https://10.0.0.5/theme.json',
      'https://172.16.0.1/theme.json',
      'https://192.168.1.10/theme.json',
      'https://169.254.169.254/latest/meta-data/',
      'https://100.64.0.1/theme.json',
      'https://0.0.0.0/theme.json',
      'https://[::1]/theme.json',
      'https://[::]/theme.json',
      'https://[fc00::1]/theme.json',
      'https://[fd12:3456::1]/theme.json',
      'https://[fe80::1]/theme.json',
      'https://[::ffff:127.0.0.1]/theme.json',
      'https://[::ffff:169.254.169.254]/theme.json',
      'https://[2002:7f00:1::]/theme.json',
      'https://[2002:a9fe:a9fe::]/theme.json',
      'https://[64:ff9b:1::1]/theme.json',
      'https://[::ffff:0:10.0.0.1]/theme.json',
    ];
    for (const url of blocked) {
      const result = validateThemeImportUrl(url);
      expect(result.ok, url).toBe(false);
    }
  });
});

describe('fetchThemeTextFromUrl', () => {
  it('fetches JSON with credentials omitted, validates redirected URLs, and rejects HTML or oversized streams', async () => {
    const sampleJson = '{"format":"feed-sanity-theme","schemaVersion":1}';
    const fetchOk = vi.fn<typeof fetch>(async () => {
      return new Response(sampleJson, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    });

    const ok = await fetchThemeTextFromUrl('https://feed-sanity.com/themes/tide.fstheme.json', {
      fetchImpl: fetchOk,
    });
    expect(ok).toEqual({
      ok: true,
      text: sampleJson,
      finalUrl: 'https://feed-sanity.com/themes/tide.fstheme.json',
    });
    expect(fetchOk).toHaveBeenCalledWith(
      'https://feed-sanity.com/themes/tide.fstheme.json',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
      }),
    );

    // Rejects HTML responses (e.g. pasting a GitHub blob page instead of raw JSON).
    const htmlRes = await fetchThemeTextFromUrl('https://github.com/user/repo/blob/main/a.json', {
      fetchImpl: async () =>
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    });
    expect(htmlRes.ok).toBe(false);
    if (!htmlRes.ok) {
      expect(htmlRes.error).toContain('HTML');
    }

    // Rejects redirects to blocked/private hosts.
    const redirected = await fetchThemeTextFromUrl('https://public.example/redirect', {
      fetchImpl: async () => {
        const res = new Response(sampleJson, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
        Object.defineProperty(res, 'url', { value: 'https://169.254.169.254/latest' });
        return res;
      },
    });
    expect(redirected).toEqual({
      ok: false,
      error: 'Theme URL redirected to a blocked address.',
    });

    // Rejects chunked responses exceeding 64 KB without relying on Content-Length.
    const hugeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_THEME_FILE_BYTES + 16).fill(0x61));
        controller.close();
      },
    });
    const oversized = await fetchThemeTextFromUrl('https://public.example/huge.fstheme.json', {
      fetchImpl: async () =>
        new Response(hugeStream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.error).toContain('64 KB limit');
    }

    // Rejects HTTP errors cleanly.
    const notFound = await fetchThemeTextFromUrl('https://public.example/missing.fstheme.json', {
      fetchImpl: async () => new Response('Not Found', { status: 404 }),
    });
    expect(notFound).toEqual({ ok: false, error: 'Server returned HTTP 404.' });

    // Rejects invalid binary/non-UTF-8 payloads.
    const badUtf8 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xfe, 0xfd]));
        controller.close();
      },
    });
    const corrupt = await fetchThemeTextFromUrl('https://public.example/bin.fstheme.json', {
      fetchImpl: async () =>
        new Response(badUtf8, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
    });
    expect(corrupt).toEqual({ ok: false, error: 'Remote file is not valid UTF-8 text.' });

    // Rejects empty payloads, timeouts, and caller aborts cleanly.
    const empty = await fetchThemeTextFromUrl('https://public.example/empty.fstheme.json', {
      fetchImpl: async () =>
        new Response('   ', { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    expect(empty).toEqual({ ok: false, error: 'Remote theme file is empty.' });

    const ac = new AbortController();
    ac.abort();
    const cancelled = await fetchThemeTextFromUrl('https://public.example/cancelled.fstheme.json', {
      signal: ac.signal,
      fetchImpl: vi.fn(),
    });
    expect(cancelled).toEqual({ ok: false, error: 'Theme fetch was cancelled.' });

    // Cancelling while a fetch is actively in flight forwards the abort signal cleanly.
    const midFlightAbort = new AbortController();
    const midFlightPromise = fetchThemeTextFromUrl(
      'https://public.example/in-flight.fstheme.json',
      {
        signal: midFlightAbort.signal,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      },
    );
    midFlightAbort.abort();
    await expect(midFlightPromise).resolves.toEqual({
      ok: false,
      error: 'Theme fetch was cancelled.',
    });

    const timedOut = await fetchThemeTextFromUrl('https://public.example/slow.fstheme.json', {
      timeoutMs: 10,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    });
    expect(timedOut).toEqual({ ok: false, error: 'Timed out while fetching theme URL.' });
  });
});
