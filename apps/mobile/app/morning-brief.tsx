// @paradigm: sql
// Morning Brief screen route — /morning-brief?date=YYYY-MM-DD
// This is THE primary product surface. Three-signal rule enforced.

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { MorningBriefScreen } from '../src/interfaces/screens/MorningBriefScreen.js';

// Sugandh-Lok workspace ID (Phase 0-1 LOCAL harness).
// In production: workspace ID comes from expo-secure-store (set at login).
const WORKSPACE_ID = process.env.EXPO_PUBLIC_WORKSPACE_ID
  ?? '00000000-0000-0000-0000-000000000001';

export default function MorningBriefRoute() {
  const { date } = useLocalSearchParams<{ date?: string }>();

  return (
    <MorningBriefScreen
      workspaceId={WORKSPACE_ID}
      date={date}
    />
  );
}
