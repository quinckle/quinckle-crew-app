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

`AuthContext` (`context/AuthContext.tsx`) holds role state (`'staff' | 'cook' | null`) in memory only — no persistence. The root `app/index.tsx` redirects based on role:

- `null` → `/login` → `/credential?role=<staff|cook>` → sets role via `login()` → redirects to role route
- `'staff'` → `/(staff)` (table floor view)
- `'cook'` → `/(cook)` (kitchen ticket view)

Logging out calls `logout()` which sets role to `null`, then navigates to `/login`.

### Screen Structure

| Route | Purpose |
|---|---|
| `app/login.tsx` | Role selection (Staff / Cook buttons) |
| `app/credential.tsx` | OTP login form; accepts Restaurant ID + email/phone + OTP (validation is front-end only — no real auth backend yet) |
| `app/(staff)/index.tsx` | Staff dashboard: table grid with status filters (available / occupied / reserved), search, and quick actions |
| `app/(staff)/[tableId].tsx` | Table detail: per-item order status, serve button, running bill total |
| `app/(cook)/index.tsx` | Cook dashboard: kitchen ticket queue with status progression, item-level checkboxes, swipe-to-bump for ready tickets, undo bar |

### Data

All data is **static/mocked in-memory** — no API or database. `TABLE_ORDER_DATA` in `[tableId].tsx` and `INITIAL_KITCHEN_ORDERS` / `INITIAL_TABLES` in the dashboards are the fixtures. State is local to each screen component via `useState`.

### Design System

All colors come from `constants/Colors.ts` via `QuinckleColors`. The theme is a dark background (`#09090b`) with an orange primary (`#F35D3B`). All styles are inline `StyleSheet.create()` — no CSS-in-JS library. The shared `ThemedDialog` component (`components/ui/themed-dialog.tsx`) is the standard modal pattern used across both role screens.

### Key Libraries

- **expo-router** — file-based navigation (Stack navigator at root)
- **react-native-gesture-handler** — powers swipe-to-remove on cook tickets (`Swipeable`)
- **react-native-reanimated** — animation primitives (worklets enabled)
- **@expo/vector-icons** (`Ionicons`) — all icons throughout the app

### Route Groups

`(staff)` and `(cook)` are Expo Router route groups — the parentheses keep them out of the URL path while allowing a shared layout per role. The root `_layout.tsx` wraps everything in `AuthProvider` and `GestureHandlerRootView`.
