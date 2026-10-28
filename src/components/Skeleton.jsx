// Skeleton loaders. <Skeleton> is the one primitive (rect / circle / text);
// the screen skeletons below are built from it and mirror each screen's real
// cards (same sizes, radius, spacing) so nothing jumps when data arrives.
// <LoadGate> picks skeleton → error (Retry) → content for a screen area.
import React from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import './Skeleton.css';

export function Skeleton({ variant = 'rect', width, height, radius, className = '', style }) {
  const s = { width, height, borderRadius: radius, ...style };
  return <span className={`sk sk--${variant} ${className}`.trim()} style={s} aria-hidden="true" />;
}

// a few text lines; the last one shorter
export function SkeletonLines({ lines = 2, width = '100%', gap = 8, lastWidth = '60%', height = 10 }) {
  return (
    <span className="sk-lines" style={{ gap, width }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} variant="text" height={height} width={i === lines - 1 && lines > 1 ? lastWidth : '100%'} />
      ))}
    </span>
  );
}

const Card = ({ children, height, style, className = '' }) => (
  <div className={`sk-card ${className}`.trim()} style={{ minHeight: height, ...style }} aria-hidden="true">{children}</div>
);

const ListCard = ({ tile = 44, pill = true }) => (
  <Card className="sk-row-card" height={78}>
    <Skeleton width={tile} height={tile} radius={12} />
    <span className="sk-grow">
      <SkeletonLines lines={2} lastWidth="45%" />
      {pill && <Skeleton width={64} height={16} radius={50} style={{ marginTop: 8 }} />}
    </span>
  </Card>
);

export function DashboardSkeleton() {
  return (
    <div className="sk-stack">
      <Card height={92}><SkeletonLines lines={2} width="55%" height={14} /></Card>
      <Card height={210}>
        <SkeletonLines lines={2} width="45%" height={12} />
        <Skeleton height={120} radius={14} style={{ marginTop: 16 }} />
      </Card>
      <Card height={96}><SkeletonLines lines={2} width="50%" height={12} /></Card>
      <div className="sk-grid-2">
        <Card height={150}><SkeletonLines lines={1} width="60%" /><Skeleton height={80} radius={12} style={{ marginTop: 14 }} /></Card>
        <Card height={150}><SkeletonLines lines={1} width="60%" /><Skeleton height={80} radius={12} style={{ marginTop: 14 }} /></Card>
      </div>
    </div>
  );
}

export function ExpensesSkeleton() {
  return (
    <div className="sk-stack">
      <div className="sk-row-scroll">
        {[0, 1, 2].map(i => <Skeleton key={i} width="72%" height={96} radius={20} style={{ flexShrink: 0 }} />)}
      </div>
      <Skeleton height={40} radius={50} />
      {[0, 1, 2, 3].map(i => <ListCard key={i} />)}
    </div>
  );
}

export function ExpenseListSkeleton({ count = 4 }) {
  return <div className="sk-stack">{Array.from({ length: count }, (_, i) => <ListCard key={i} />)}</div>;
}

export function GroupsSkeleton() {
  return (
    <div className="sk-stack">
      {[0, 1, 2].map(i => (
        <Card key={i} height={196}>
          <span className="sk-row">
            <Skeleton variant="circle" width={44} height={44} />
            <span className="sk-grow"><SkeletonLines lines={2} lastWidth="35%" /></span>
          </span>
          <div className="sk-grid-3" style={{ marginTop: 14 }}>
            {[0, 1, 2].map(j => <Skeleton key={j} height={58} radius={12} />)}
          </div>
          <span className="sk-avatars">
            {[0, 1, 2].map(j => <Skeleton key={j} variant="circle" width={26} height={26} />)}
          </span>
        </Card>
      ))}
    </div>
  );
}

export function UtilitiesSkeleton() {
  return (
    <div className="sk-stack">
      <div className="sk-grid-2">
        <Card height={96}><SkeletonLines lines={2} lastWidth="70%" height={12} /></Card>
        <Card height={96}><SkeletonLines lines={2} lastWidth="70%" height={12} /></Card>
      </div>
      <span className="sk-row">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} width={72} height={30} radius={50} />)}
      </span>
      {[0, 1, 2, 3].map(i => <ListCard key={i} />)}
    </div>
  );
}

export function ReportsSkeleton() {
  return (
    <div className="sk-stack">
      <div className="sk-grid-2">
        <Card height={100}><SkeletonLines lines={2} lastWidth="70%" height={12} /></Card>
        <Card height={100}><SkeletonLines lines={2} lastWidth="70%" height={12} /></Card>
      </div>
      <Card height={220}><SkeletonLines lines={1} width="40%" /><Skeleton height={160} radius={14} style={{ marginTop: 16 }} /></Card>
      <Card height={180}><SkeletonLines lines={1} width="45%" /><Skeleton height={120} radius={14} style={{ marginTop: 16 }} /></Card>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="sk-stack">
      <Card height={96} className="sk-row-card">
        <Skeleton variant="circle" width={56} height={56} />
        <span className="sk-grow"><SkeletonLines lines={2} lastWidth="55%" height={12} /></span>
      </Card>
      <Card height={180}>
        {[0, 1, 2].map(i => (
          <span key={i} className="sk-row" style={{ padding: '10px 0' }}>
            <Skeleton width={36} height={36} radius={10} />
            <span className="sk-grow"><Skeleton variant="text" width="55%" height={12} /></span>
          </span>
        ))}
      </Card>
    </div>
  );
}

// Modals: Payment History / member details
export function ModalListSkeleton({ rows = 3 }) {
  return (
    <div className="sk-stack" style={{ gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="sk-row" style={{ padding: '6px 0' }}>
          <Skeleton variant="circle" width={34} height={34} />
          <span className="sk-grow"><SkeletonLines lines={2} lastWidth="40%" /></span>
        </span>
      ))}
    </div>
  );
}

/**
 * One screen area: skeleton (first load only) → error with Retry → content.
 *   load      result of useScreenLoad()
 *   skeleton  the screen's skeleton element
 *   onRetry   re-runs the screen's fetch
 *   minHeight space kept while waiting the first 200 ms
 */
export function LoadGate({ load, skeleton, onRetry, minHeight = 320, children }) {
  if (load.error && !load.loaded) {
    return (
      <div className="sk-error" role="alert">
        {load.offline ? <WifiOff size={28} strokeWidth={1.75} aria-hidden="true" /> : <RefreshCw size={28} strokeWidth={1.75} aria-hidden="true" />}
        <p className="sk-error-title">{load.offline ? 'You’re offline' : 'Couldn’t load this'}</p>
        <p className="sk-error-sub">{load.offline ? 'Connect to the internet and try again.' : 'Check your connection and try again.'}</p>
        <button type="button" className="sk-retry" onClick={() => { load.retrying(); onRetry?.(); }}>Retry</button>
      </div>
    );
  }
  if (!load.loaded || load.showSkeleton) {
    return (
      <div className="sk-area" aria-busy="true" style={{ minHeight }}>
        <span className="sk-sr-only">Loading</span>
        {load.showSkeleton && skeleton}
      </div>
    );
  }
  return (
    <>
      {load.offline && <span className="sk-offline" role="status"><WifiOff size={12} strokeWidth={1.75} aria-hidden="true" /> Offline</span>}
      {children}
    </>
  );
}
