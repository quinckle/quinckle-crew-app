/**
 * Icons for the table panel's empty states — web / Electron desktop.
 * Native twin: TableIcons.tsx (Ionicons). Keep the two files' exports identical.
 */

import React from 'react';
import { GiNotebook } from 'react-icons/gi';
import { MdTableRestaurant } from 'react-icons/md';

type IconProps = { size?: number; color: string };

/** "Table is free" — a notebook glyph. */
export function TableAvailableIcon({ size = 22, color }: IconProps) {
  return <GiNotebook size={size} color={color} />;
}

/** "No table selected" — the panel's idle placeholder. */
export function NoTableSelectedIcon({ size = 22, color }: IconProps) {
  return <MdTableRestaurant size={size} color={color} />;
}
