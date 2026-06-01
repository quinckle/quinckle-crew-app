# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npx expo start       # Start dev server (scan QR with Expo Go, or press a/i/w for emulator)
npm run android      # Launch on Android emulator directly
npm run ios          # Launch on iOS simulator directly
npm run web          # Launch in browser
npm run lint         # Run ESLint via expo lint
```

There is no test suite configured. TypeScript type-checking runs through the IDE or `tsc --noEmit`.

## Architecture

**QuinckleCrew** is a React Native / Expo restaurant staff coordination app with two distinct user roles: **Staff** (front-of-house, manages tables) and **Cook** (kitchen, manages order tickets). The app uses Expo Router v6 with file-based routing and the new React architecture (`newArchEnabled: true`, React Compiler enabled).

### Auth & Routing Flow

`AuthContext` (`context/AuthContext.tsx`) holds role state (`'staff' | 'cook' | null`), the crew JWT, and `staffInfo`. The JWT is persisted in SecureStore (Keychain/Keystore) and `staffInfo` in AsyncStorage, restored on launch (`isRestoring`). A 401 on an authenticated request auto-logs-out via the `setOn401Callback` hook. The root `app/index.tsx` redirects based on role:

- `null` → `/login` → `/credential?role=<staff|cook>` → sets role via `login()` → redirects to role route
- `'staff'` → `/(staff)` (table floor view)
- `'cook'` → `/(cook)` (kitchen ticket view)

Logging out calls `logout()` which sets role to `null`, then navigates to `/login`.

### Screen Structure

| Route | Purpose |
|---|---|
| `app/login.tsx` | Role selection (Staff / Cook buttons) |
| `app/credential.tsx` | OTP login form; phone + OTP verified against the ops backend (`crewAuth.sendOtp` / `verifyOtp`) which returns the crew JWT + staff profile |
| `app/(staff)/index.tsx` | Staff dashboard: table grid with status filters (available / occupied / reserved), search, and quick actions |
| `app/(staff)/[tableId].tsx` | Table detail: per-item order status, serve button, running bill total |
| `app/(cook)/index.tsx` | Cook dashboard: kitchen ticket queue with status progression, item-level checkboxes, swipe-to-bump for ready tickets, undo bar |

### Data

All data comes from the **ops backend** (`quinckle-user-app-backend`) via `services/api.ts`, with **Ably realtime** (`services/realtime.ts`) pushing live order/table/payment updates. KOT and bill printing go through `services/printer.ts` (Bluetooth thermal, paired config in AsyncStorage — restored on launch by `initPrinter()` in `app/_layout.tsx`). Screen state is local `useState`, hydrated from the API. (Historical note: early versions used in-memory fixtures; that is no longer the case.)

### Design System

All colors come from `constants/Colors.ts` via `QuinckleColors`. The theme is a dark background (`#09090b`) with an orange primary (`#F35D3B`). All styles are inline `StyleSheet.create()` — no CSS-in-JS library. The shared `ThemedDialog` component (`components/ui/themed-dialog.tsx`) is the standard modal pattern used across both role screens.

### Key Libraries

- **expo-router** — file-based navigation (Stack navigator at root)
- **react-native-gesture-handler** — powers swipe-to-remove on cook tickets (`Swipeable`)
- **react-native-reanimated** — animation primitives (worklets enabled)
- **@expo/vector-icons** (`Ionicons`) — all icons throughout the app

### Route Groups

`(staff)` and `(cook)` are Expo Router route groups — the parentheses keep them out of the URL path while allowing a shared layout per role. The root `_layout.tsx` wraps everything in `AuthProvider` and `GestureHandlerRootView`.
