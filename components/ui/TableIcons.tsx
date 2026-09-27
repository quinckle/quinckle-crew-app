/**
 * Icons for the table panel's empty states — native (iOS / Android).
 *
 * The desktop build (TableIcons.web.tsx) draws these from react-icons, which
 * renders DOM <svg> and cannot run in React Native. Metro picks the .web file
 * for the web/Electron bundle, so react-icons never enters the native bundle;
 * phones keep the closest Ionicons glyph. Keep the two files' exports identical.
 */

import React from 'react';
import { Ionicons } from '@expo/vector-icons';

type IconProps = { size?: number; color: string };

/** "Table is free" — a plate/cutlery glyph. */
export function TableAvailableIcon({ size = 22, color }: IconProps) {
  return <Ionicons name="restaurant-outline" size={size} color={color} />;
}

/** "No table selected" — the panel's idle placeholder. */
export function NoTableSelectedIcon({ size = 22, color }: IconProps) {
  return <Ionicons name="grid-outline" size={size} color={color} />;
}
