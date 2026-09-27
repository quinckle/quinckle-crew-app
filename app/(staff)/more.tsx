/**
 * Menu screen — what the burger icon opens on phones and tablets. Desktop opens
 * the same menu as a left-hand drawer over the table screen instead; see
 * components/menu/MenuPanel.tsx for the content and why it is shared.
 */

import React from 'react';
import { router } from 'expo-router';
import { MenuPanel } from '../../components/menu/MenuPanel';

export default function MoreScreen() {
  return (
    <MenuPanel
      variant="sheet"
      onClose={() => router.back()}
      onNavigate={(route) => router.push(route as any)}
    />
  );
}
