// @paradigm: sql
// App home — redirects to the Morning Brief as the primary surface.

import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';

export default function IndexRoute() {
  const router = useRouter();

  useEffect(() => {
    // Navigate to the Morning Brief — the primary product surface.
    router.replace('/morning-brief');
  }, [router]);

  return (
    <View style={styles.container}>
      <Text style={styles.text} accessibilityRole="text">Loading Brain...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  text: {
    fontSize: 16,
    color: '#6C757D',
  },
});
