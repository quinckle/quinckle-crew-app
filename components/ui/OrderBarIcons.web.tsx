/**
 * Icons for the manual-order footer pill — web / Electron desktop.
 * Native twin: OrderBarIcons.tsx (Ionicons). Keep the two files' exports identical.
 */

import React from 'react';
import { MdStickyNote2 } from 'react-icons/md';
import { IoIosContact } from 'react-icons/io';

type IconProps = { size?: number; color: string };

/** "Order summary" — a sticky note. */
export function OrderSummaryIcon({ size = 18, color }: IconProps) {
  return <MdStickyNote2 size={size} color={color} />;
}

/** "Customer" — a contact card. */
export function CustomerIcon({ size = 20, color }: IconProps) {
  return <IoIosContact size={size} color={color} />;
}
