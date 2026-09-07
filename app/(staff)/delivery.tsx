/**
 * Standalone delivery route.
 *
 * Delivery now lives as a bottom-nav tab on the staff dashboard — see
 * components/delivery/DeliveryBoard. This route stays so that anything holding
 * a link to /(staff)/delivery (a notification, a saved deep link) still opens
 * the same board, with its own header instead of the dashboard's.
 */
import React from 'react';
import { DeliveryBoard } from '../../components/delivery/DeliveryBoard';

export default function DeliveryScreen() {
  return <DeliveryBoard />;
}
