// One place for every icon in the UI (Lucide), so screens stay consistent.
//   CATEGORY_ICON  expense / utility category → icon
//   ICONS          app concepts (household, members, owner, delete, edit …)
//   NOTIF_ICON     notification type → icon
// Components:
//   <Icon as={Zap} />                 Lucide icon with the app's stroke; decorative
//                                     (aria-hidden) unless you pass `label`
//   <CategoryIcon category="Water" /> category icon in a rounded tinted tile
//                                     (theme variables); `tile={false}` → bare icon
//   <IconText icon={Users}>Members</IconText>   icon + text, inline
//   <StatusIcon status="paid" />      Check / Clock / X for status pills
// Sizes: 20px in lists (default), 24px in headers / nav. Emojis stay only in
// what people type themselves (chat, notes).
import React from 'react';
import { STROKE, categoryIconOf, statusIconFor } from '../utils/iconMap';

export function Icon({ as: Comp, size = 20, label, className, ...rest }) {
  if (!Comp) return null;
  return (
    <Comp
      size={size}
      strokeWidth={STROKE}
      className={className}
      {...(label ? { 'aria-label': label, role: 'img' } : { 'aria-hidden': true })}
      {...rest}
    />
  );
}

// Small icon in front of a line of text (labels, notes, buttons)
export function InlineIcon({ as, size = 14 }) {
  return <Icon as={as} size={size} className="inline-ic" />;
}

export function CategoryIcon({ category, size = 20, tile = true, className = '' }) {
  const icon = <Icon as={categoryIconOf(category)} size={size} />;
  if (!tile) return icon;
  return <span className={`cat-tile ${className}`.trim()} aria-hidden="true">{icon}</span>;
}

export function IconText({ icon, size = 16, children, className = '' }) {
  return (
    <span className={`ic-text ${className}`.trim()}>
      <Icon as={icon} size={size} />
      <span>{children}</span>
    </span>
  );
}

export function StatusIcon({ status, size = 12 }) {
  return <Icon as={statusIconFor(status)} size={size} className="status-ic" />;
}
