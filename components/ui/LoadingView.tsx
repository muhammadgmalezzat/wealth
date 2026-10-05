import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';

export function LoadingView() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary700} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
