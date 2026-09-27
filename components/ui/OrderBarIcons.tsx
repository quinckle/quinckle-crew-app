/**
 * Icons for the manual-order footer pill — native (iOS / Android).
 *
 * The desktop build (OrderBarIcons.web.tsx) draws these from react-icons, which
 * renders DOM <svg> and cannot run in React Native. Metro picks the .web file
 * for the web/Electron bundle, so react-icons never enters the native bundle;
 * phones keep the closest Ionicons glyph. Keep the two files' exports identical.
 */

import React from 'react';
import { Ionicons } from '@expo/vector-icons';

type IconProps = { size?: number; color: string };

/** "Order summary" — a sticky note. */
export function OrderSummaryIcon({ size = 18, color }: IconProps) {
  return <Ionicons name="document-text" size={size} color={color} />;
}

/** "Customer" — a contact card. */
export function CustomerIcon({ size = 20, color }: IconProps) {
  return <Ionicons name="person-circle" size={size} color={color} />;
}
