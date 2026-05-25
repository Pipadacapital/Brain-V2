// @paradigm: sql
// CF-C6-MB-PUSH-TOKEN-1: Expo push token REGISTRATION only.
// Push SEND is OUT OF SCOPE — that is the notifications-service (later child).
//
// This module handles:
//   1. Requesting push notification permission (expo-notifications).
//   2. Getting the Expo push token.
//   3. Calling device.registerPushToken on the api-gateway (idempotent upsert).
//   4. Re-registering on foreground resume (token rotation).
//
// CF-C6-MB-PUSH-TOKEN-1: token rotation on foreground (Expo tokens can rotate).
// The server upserts on (workspace_id, user_id, device_id) — idempotent.
//
// CF-C6-PII-CLIENT-1: no PII logged. Only token + workspace metadata.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { trpcClient } from './trpc-client.js';

// Configure notification handler (how notifications behave while app is foregrounded).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request push notification permissions and register the Expo push token
 * with the Brain api-gateway.
 *
 * CF-C6-MB-PUSH-TOKEN-1: REGISTRATION only; no SEND.
 *
 * @param workspaceId - current workspace (scoping the token to the right tenant)
 * @param _userId - current user UUID. Kept for signature stability but NO LONGER
 *   sent to the gateway: per Slice A (S4), the server derives user_id from the
 *   verified claim, never from client input.
 * @returns the Expo push token string, or null if permission denied / not a device
 */
export async function registerPushToken(
  workspaceId: string,
  _userId: string,
): Promise<string | null> {
  // Push notifications are not supported on simulators.
  if (!Device.isDevice) {
    console.info('[push] Skipping push registration — not a physical device (simulator/emulator).');
    return null;
  }

  // Request permission.
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.info('[push] Push notification permission not granted.');
    return null;
  }

  // Android: configure channel.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('morning-brief', {
      name: 'Morning Brief',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  // Get the Expo push token.
  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({
      projectId: Application.applicationId ?? undefined,
    });
    token = result.data;
  } catch (err) {
    console.info('[push] Failed to get Expo push token:', err instanceof Error ? err.message : 'unknown');
    return null;
  }

  // Device ID: use Application.androidId (Android) or Device.deviceName (iOS fallback).
  // Application.getAndroidId() is async (expo-application v6+); fall back to Device.deviceName.
  const deviceId =
    (Platform.OS === 'android'
      ? (await Application.getAndroidId?.() ?? null)
      : Device.deviceName) ?? `device_${Platform.OS}`;

  // Register with the api-gateway (idempotent upsert).
  // CF-C6-MB-PUSH-TOKEN-1: token stored in core.device_tokens (server-side RLS-scoped).
  try {
    // S4 (Slice A): user_id is NO LONGER sent — the gateway derives it from the
    // verified claim (a client may not register a token on behalf of another user).
    await trpcClient.device.registerPushToken.mutate({
      device_id: deviceId,
      expo_push_token: token,
    });
    console.info('[push] Token registered with Brain api-gateway.');
  } catch (err) {
    // Non-fatal: registration failure does not block the app.
    console.info('[push] Token registration failed (non-fatal):', err instanceof Error ? err.message : 'unknown');
  }

  return token;
}

/**
 * Deep-link handler: extracts the brief date from a push notification tap.
 * On push tap → Expo routing navigates to /morning-brief?date=<date>.
 *
 * CF-C6-MB-PUSH-TOKEN-1: deep-link handler wired here; silent re-auth
 * happens in the Expo Router layout via expo-secure-store refresh token.
 */
export function extractBriefDateFromNotification(
  notification: Notifications.Notification,
): string | null {
  const data = notification.request.content.data as Record<string, unknown> | null;
  if (data && typeof data['date'] === 'string') {
    return data['date'];
  }
  return null;
}
