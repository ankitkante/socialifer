// Shared look: colours, a button, and the screen frame (Android draws the app under the status bar).
import { Pressable, StatusBar, StyleSheet, Text as RNText, TextInput as RNTextInput, View } from 'react-native';

// Inter, one file per weight (assets/fonts, loaded in App.js), because Android can't pick a weight from one
// variable font. Hindi isn't in Inter: Android falls back to its own Devanagari font, which is Noto Sans Devanagari.
export const FONTS = {
  Inter_400Regular: require('../assets/fonts/Inter_400Regular.ttf'),
  Inter_500Medium: require('../assets/fonts/Inter_500Medium.ttf'),
  Inter_600SemiBold: require('../assets/fonts/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('../assets/fonts/Inter_700Bold.ttf'),
};

// Turns fontWeight into the matching Inter file; a style with its own fontFamily (the log's monospace) keeps it.
function withFont(style) {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  const weight = flat.fontWeight === 'bold' ? 700 : Number(flat.fontWeight) || 400;
  const family = weight >= 700 ? 'Inter_700Bold' : weight >= 600 ? 'Inter_600SemiBold' : weight >= 500 ? 'Inter_500Medium' : 'Inter_400Regular';
  // fontWeight goes back to normal, or Android thickens the already-bold file further.
  return [style, { fontFamily: family, fontWeight: 'normal' }];
}

// Use these instead of react-native's Text and TextInput, so every screen gets the brand font.
export function Text(props) {
  return <RNText {...props} style={withFont(props.style)} />;
}
export function TextInput(props) {
  return <RNTextInput {...props} style={withFont(props.style)} />;
}

export const colors = {
  // Socialifer's colours (brand/README.md): Ink text, Mist for soft panels, Dusk Plum accent.
  text: '#1e1b26', muted: '#5f5a6b', line: '#dcd8e3', bg: '#fff', soft: '#f5f4f7',
  accent: '#5b4a8b', placeholder: '#8a8597', danger: '#b00020', ok: '#137333', warn: '#9a6700',
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
