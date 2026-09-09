/**
 * Standalone delivery route.
 *
 * Delivery now lives as a bottom-nav tab on the staff dashboard — see
 * components/delivery/DeliveryBoard and RiderRuns. This route stays so that
 * anything holding a link to /(staff)/delivery (a notification, a saved deep
 * link) still opens the same surface, with its own header instead of the
 * dashboard's.
 *
 * It picks the view the SAME way the tab does (DELIVERY_V2_PLAN §3) — one
 * helper, so a rider following a notification can never land on the counter's
 * board, which is the one place they could dispatch a bag to themselves.
 */
import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { deliveryViewFor } from '../../constants/capabilities';
import { DeliveryBoard } from '../../components/delivery/DeliveryBoard';
import { RiderRuns } from '../../components/delivery/RiderRuns';

export default function DeliveryScreen() {
  const { capabilities } = useAuth();
  return deliveryViewFor(capabilities) === 'RIDER' ? <RiderRuns /> : <DeliveryBoard />;
}
