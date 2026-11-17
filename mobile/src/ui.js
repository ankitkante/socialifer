// Shared look: colours, a button, and the screen frame (Android draws the app under the status bar).
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';

export const colors = {
  text: '#1a1a1a', muted: '#666', line: '#ddd', bg: '#fff', soft: '#f3f4f6',
  accent: '#1a73e8', placeholder: '#8a8a8a', danger: '#b00020', ok: '#137333', warn: '#9a6700',
};

export function Screen({ children }) {
  return <View style={[styles.screen, { paddingTop: (StatusBar.currentHeight ?? 0) + 12 }]}>{children}</View>;
}

export function Button({ label, onPress, disabled, kind = 'primary', style }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.button, styles[kind], disabled && styles.disabled, style]}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={[styles.buttonText, kind !== 'primary' && { color: kind === 'danger' ? colors.danger : colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  button: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center' },
  primary: { backgroundColor: colors.accent },
  secondary: { borderWidth: 1, borderColor: colors.accent },
  danger: { borderWidth: 1, borderColor: colors.danger },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '500' },
});
