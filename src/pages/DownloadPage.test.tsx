// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DownloadPage from './DownloadPage';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function stream() {
  const reads: ReturnType<typeof deferred<{ value?: Uint8Array; done: boolean }>>[] = [];
  const reader = {
    read: vi.fn(() => { const next = deferred<{ value?: Uint8Array; done: boolean }>(); reads.push(next); return next.promise; }),
    cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn(),
  };
  return {
    reader, reads,
    response: { ok: true, headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
      body: { getReader: () => reader, cancel: vi.fn().mockResolvedValue(undefined) } } as unknown as Response,
    async send(events: unknown[], done = false) {
      await waitFor(() => expect(reads.length).toBeGreaterThan(0));
      await act(async () => reads.shift()!.resolve({ value: new TextEncoder().encode(events.map(e => JSON.stringify(e)).join('\n') + '\n'), done }));
    },
  };
}
function start(view: ReturnType<typeof render>) {
  fireEvent.change(view.getByLabelText(/Video URL/), { target: { value: 'https://youtu.be/test' } });
  fireEvent.submit(view.container.querySelector('form')!);
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('aborts pending fetch, restarts immediately and ignores old fetch failure/finalizer', async () => {
  const old = deferred<Response>();
  const next = stream();
  vi.mocked(fetch).mockReturnValueOnce(old.promise).mockResolvedValueOnce(next.response);
  const view = render(<DownloadPage />);
  start(view);
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(signal.aborted).toBe(true);
  expect(view.getByRole('status').textContent).toBe('Cancelled');
  start(view);
  await act(async () => old.reject(new Error('old error')));
  expect(view.queryByText('old error')).toBeNull();
  expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  await next.send([{ type: 'progress', stage: 'download', total_bytes: 100, downloaded_bytes: 50, speed: 1024, eta: 2 }]);
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  expect(view.getByRole('status').textContent).toContain('ETA 2s');
  view.unmount();
  expect(vi.mocked(fetch).mock.calls[1][1]!.signal!.aborted).toBe(true);
  await next.send([{ type: 'ready', url: '/late', filename: 'late.mp4' }], true);
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(next.reader.cancel).toHaveBeenCalled();
});

it('ignores buffered old ready/progress after cancel and does not clear the new controller', async () => {
  const old = stream();
  const next = stream();
  vi.mocked(fetch).mockResolvedValueOnce(old.response).mockResolvedValueOnce(next.response);
  const view = render(<DownloadPage />);
  start(view);
  await waitFor(() => expect(old.reader.read).toHaveBeenCalled());
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  start(view);
  await old.send([{ type: 'progress', stage: 'download', total_bytes: 1, downloaded_bytes: 1 },
    { type: 'ready', url: '/old', filename: 'old.mp4' }], true);
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(view.getByRole('status').textContent).toBe('Loading metadata');
  expect(view.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(vi.mocked(fetch).mock.calls[1][1]!.signal!.aborted).toBe(true);
  await next.send([], true);
});

it('shows structured phases, bounded expandable logs and a native ready download', async () => {
  const current = stream();
  vi.mocked(fetch).mockResolvedValue(current.response);
  const view = render(<DownloadPage />);
  start(view);
  await current.send([{ type: 'log', message: 'x'.repeat(100_100) },
    { type: 'progress', stage: 'download', total_bytes_estimate: 100, downloaded_bytes: 50 }]);
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  expect(view.getByLabelText('Operation logs').textContent).toHaveLength(100_000);
  expect(view.container.querySelector('details')!.open).toBe(false);
  fireEvent.click(view.getByText('Show logs'));
  await current.send([{ type: 'progress', stage: 'postprocess', total_bytes: 100, downloaded_bytes: 100 }]);
  expect(view.getByRole('status').textContent).toBe('Postprocessing');
  await current.send([{ type: 'ready', url: '/api/download/token', filename: 'video.mp4' }], true);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  expect(view.queryByRole('progressbar')).toBeNull();
  expect(view.getByRole('status').textContent).toBe('Ready to download');
});

it('reports premature EOF without fabricating completion', async () => {
  const current = stream();
  vi.mocked(fetch).mockResolvedValue(current.response);
  const view = render(<DownloadPage />);
  start(view);
  await current.send([], true);
  expect(view.getByRole('status').textContent).toBe('Download failed');
  expect(view.getByText(/connection ended/)).toBeTruthy();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it('aborts on unmount before fetch resolves and cancels a late response body', async () => {
  const pending = deferred<Response>();
  const current = stream();
  vi.mocked(fetch).mockReturnValue(pending.promise);
  const view = render(<DownloadPage />);
  start(view);
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(current.response));
  expect(current.response.body!.cancel).toHaveBeenCalledOnce();
  expect(current.reader.read).not.toHaveBeenCalled();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it('handles split UTF-8 messages and a final ready line without a newline', async () => {
  const current = stream();
  vi.mocked(fetch).mockResolvedValue(current.response);
  const view = render(<DownloadPage />);
  start(view);
  await waitFor(() => expect(current.reads.length).toBe(1));
  const encoded = new TextEncoder().encode(JSON.stringify({ type: 'log', message: 'café' }) + '\n');
  const split = encoded.indexOf(0xc3) + 1;
  await act(async () => current.reads.shift()!.resolve({ value: encoded.slice(0, split), done: false }));
  expect(view.getByLabelText('Operation logs').textContent).toBe('');
  await act(async () => current.reads.shift()!.resolve({ value: encoded.slice(split), done: false }));
  expect(view.getByLabelText('Operation logs').textContent).toBe('café\n');
  await act(async () => current.reads.shift()!.resolve({
    value: new TextEncoder().encode(JSON.stringify({ type: 'ready', url: '/file', filename: 'café.mp4' })), done: true,
  }));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  expect(current.reader.releaseLock).toHaveBeenCalledOnce();
});

it('does not let delayed reader cleanup finish a restarted request', async () => {
  const old = stream();
  const next = stream();
  const cleanupDone = deferred<void>();
  old.reader.cancel.mockReturnValue(cleanupDone.promise);
  vi.mocked(fetch).mockResolvedValueOnce(old.response).mockResolvedValueOnce(next.response);
  const view = render(<DownloadPage />);
  start(view);
  await old.send([{ type: 'error', message: 'Service failure' }], true);
  // Cleanup is deliberately pending: cancellation must still release the UI.
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  start(view);
  await act(async () => cleanupDone.resolve());
  expect(view.queryByText('Service failure')).toBeNull();
  expect(view.getByRole('status').textContent).toBe('Loading metadata');
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(vi.mocked(fetch).mock.calls[1][1]!.signal!.aborted).toBe(true);
  await next.send([], true);
});
