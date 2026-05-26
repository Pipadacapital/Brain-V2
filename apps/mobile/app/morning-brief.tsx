// @paradigm: sql
// Morning Brief screen route — /morning-brief?date=YYYY-MM-DD
// This is THE primary product surface. Three-signal rule enforced.

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { MorningBriefScreen } from '../src/interfaces/screens/MorningBriefScreen.js';

// Workspace ID — REQUIRED env var. Production: set at login via expo-secure-store.
// The Sugandh-Lok hardcoded fallback was removed on 2026-05-26 (Founder destub
// Rip C); the app fails loudly rather than silently routing to a wrong workspace.

const WORKSPACE_ID = process.env.EXPO_PUBLIC_WORKSPACE_ID;

export default function MorningBriefRoute() {
  const { date } = useLocalSearchParams<{ date?: string }>();

  if (!WORKSPACE_ID) {
    throw new Error(
      'EXPO_PUBLIC_WORKSPACE_ID is required. Set it in apps/mobile/.env or via EAS.',
    );
  }

  return (
    <MorningBriefScreen
      workspaceId={WORKSPACE_ID}
      date={date}
    />
  );
}
