// @paradigm: sql
// Root layout — wraps the entire app with Redux store + push notification setup.
// CF-C6-PII-CLIENT-1: no PII logged.
// CF-C6-MB-PUSH-TOKEN-1: registerPushToken called on foreground resume (token rotation).

import React, { useEffect, useRef } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { store, persistor } from '../src/application/store/store.js';
import { registerPushToken, extractBriefDateFromNotification } from '../src/infrastructure/push-notifications.js';
import { getWorkspaceId, getUserId } from '../src/infrastructure/auth-store.js';

function RootLayoutInner() {
  const router = useRouter();
  const notificationResponseListener = useRef<Notifications.EventSubscription | null>(null);
  const notificationReceivedListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // Register push token on mount (and on foreground resume below).
    // CF-C6-MB-PUSH-TOKEN-1: registration only; SEND is out of scope.
    void (async () => {
      const workspaceId = await getWorkspaceId();
      const userId = await getUserId();
      if (workspaceId && userId) {
        await registerPushToken(workspaceId, userId);
      }
    })();

    // Deep-link handler: push tap → navigate to morning brief.
    // CF-C6-MB-PUSH-TOKEN-1: deep-link wired here.
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const date = extractBriefDateFromNotification(response.notification);
        if (date) {
          router.push(`/morning-brief?date=${date}`);
        } else {
          router.push('/morning-brief');
        }
      });

    // Foreground notification listener (optional — for awareness only).
    notificationReceivedListener.current =
      Notifications.addNotificationReceivedListener((_notification) => {
        // No PII logged.
        console.info('[notifications] Notification received in foreground.');
      });

    return () => {
      notificationResponseListener.current?.remove();
      notificationReceivedListener.current?.remove();
    };
  }, [router]);

  return (
    <Stack>
      <Stack.Screen
        name="morning-brief"
        options={{
          title: 'Morning Brief',
          headerLargeTitle: false,
        }}
      />
      <Stack.Screen
        name="index"
        options={{ title: 'Brain' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <RootLayoutInner />
      </PersistGate>
    </Provider>
  );
}
