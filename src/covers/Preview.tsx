import { useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';

const pending = new Map<string, Promise<string>>();
const ready = new Map<string, string>();
export function previewSource(key: string): Promise<string> {
  if (!isTauri()) return Promise.resolve(key);
  const cached = ready.get(key);
  if (cached) return Promise.resolve(cached);
  const active = pending.get(key);
  if (active) return active;
  const request = invoke<string>('cover_preview', { key }).then(path => {
    const source = convertFileSrc(path);
    ready.set(key, source);
    return source;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

// Keep the original style reference local. Only visible gallery previews use the network.
export default function CoverPreview({ src, fallback, alt, loading = 'lazy' }: {
  src: string; fallback: string; alt: string; loading?: 'lazy' | 'eager';
}) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState({ key: src, source: isTauri() ? fallback : src, status: isTauri() ? 'waiting' : 'ready' });
  const current = state.key === src ? state : { key: src, source: fallback, status: 'waiting' };
  useEffect(() => {
    let live = true, visible = loading === 'eager', running = false;
    setState({ key: src, source: isTauri() ? fallback : src, status: isTauri() ? 'waiting' : 'ready' });
    if (!isTauri()) return;
    const load = () => {
      if (!visible || running) return;
      running = true;
      setState({ key: src, source: fallback, status: 'loading' });
      void previewSource(src).then(source => {
        if (live) setState({ key: src, source, status: 'ready' });
      }).catch(() => {
        if (live) setState({ key: src, source: fallback, status: 'unavailable' });
      }).finally(() => { running = false; });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { visible = true; observer?.disconnect(); load(); }
    }, { rootMargin: '100px' });
    if (visible || !observer) { visible = true; load(); }
    else if (image.current) observer.observe(image.current);
    window.addEventListener('online', load);
    return () => { live = false; observer?.disconnect(); window.removeEventListener('online', load); };
  }, [src, fallback, loading]);
  return <img ref={image} src={current.source} alt={alt} loading={loading} data-preview-state={current.status}
    title={current.status === 'unavailable' ? '封面预览暂不可用，显示本地画风参考图；联网后自动重试' : current.status === 'ready' ? alt : '正在加载封面预览，当前显示本地画风参考图'}
    onError={() => { ready.delete(src); setState({ key: src, source: fallback, status: 'unavailable' }); }} />;
}
