// Shared look: colours, the Paper theme, a button, text fields, the snackbar and the screen frame (Android draws
// the app under the status bar). Controls come from React Native Paper (chosen 2026-11-19), themed with the brand.
import { createContext, useCallback, useContext, useState } from 'react';
import { StatusBar, StyleSheet, Text as RNText, View } from 'react-native';
import { Button as PaperButton, MD3LightTheme, Snackbar, TextInput as PaperTextInput } from 'react-native-paper';

// Inter, one file per weight (assets/fonts, loaded in App.js), because Android can't pick a weight from one
// variable font. Hindi isn't in Inter: Android falls back to its own Devanagari font, which is Noto Sans Devanagari.
export const FONTS = {
  Inter_400Regular: require('../assets/fonts/Inter_400Regular.ttf'),
  Inter_500Medium: require('../assets/fonts/Inter_500Medium.ttf'),
  Inter_600SemiBold: require('../assets/fonts/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('../assets/fonts/Inter_700Bold.ttf'),
};

const familyFor = (weight) => (weight >= 700 ? 'Inter_700Bold' : weight >= 600 ? 'Inter_600SemiBold' : weight >= 500 ? 'Inter_500Medium' : 'Inter_400Regular');

// Turns fontWeight into the matching Inter file; a style with its own fontFamily (the log's monospace) keeps it.
function withFont(style) {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  const weight = flat.fontWeight === 'bold' ? 700 : Number(flat.fontWeight) || 400;
  // fontWeight goes back to normal, or Android thickens the already-bold file further.
  return [style, { fontFamily: familyFor(weight), fontWeight: 'normal' }];
}

// Use these instead of react-native's Text, so every screen gets the brand font.
export function Text(props) {
  return <RNText {...props} style={withFont(props.style)} />;
}

export const colors = {
  // Socialifer's colours (brand/README.md): Ink text, Mist for soft panels, Dusk Plum accent.
  text: '#1e1b26', muted: '#5f5a6b', line: '#dcd8e3', bg: '#fff', soft: '#f5f4f7',
  accent: '#5b4a8b', accentSoft: '#ece8f4', placeholder: '#8a8597', danger: '#b00020', ok: '#137333', warn: '#9a6700',
};

// Paper's Material 3 theme in the brand's colours, with every text style in Inter.
export const theme = {
  ...MD3LightTheme,
  roundness: 3,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.accent, onPrimary: '#fff', primaryContainer: colors.accentSoft, onPrimaryContainer: colors.text,
    secondary: colors.accent, secondaryContainer: colors.accentSoft, onSecondaryContainer: colors.text,
    background: colors.bg, surface: colors.bg, surfaceVariant: colors.soft, onSurface: colors.text, onSurfaceVariant: colors.muted,
    outline: colors.line, outlineVariant: colors.line, error: colors.danger,
    elevation: { ...MD3LightTheme.colors.elevation, level0: 'transparent', level1: colors.bg, level2: colors.soft, level3: colors.soft },
  },
  fonts: Object.fromEntries(Object.entries(MD3LightTheme.fonts).map(([name, f]) => [
    name, typeof f === 'object' ? { ...f, fontFamily: familyFor(Number(f.fontWeight) || 400), fontWeight: 'normal' } : f,
  ])),
};

export function Screen({ children }) {
  return <View style={[styles.screen, { paddingTop: (StatusBar.currentHeight ?? 0) + 12 }]}>{children}</View>;
}

// kind: primary (filled), secondary (outlined), danger (outlined, red) or text (a link-like button).
export function Button({ label, onPress, disabled, kind = 'primary', icon, style, compact }) {
  const mode = kind === 'primary' ? 'contained' : kind === 'text' ? 'text' : 'outlined';
  return (
    <PaperButton
      mode={mode}
      icon={icon}
      onPress={onPress}
      disabled={disabled}
      compact={compact}
      textColor={kind === 'danger' ? colors.danger : undefined}
      style={[!disabled && kind === 'danger' && { borderColor: colors.danger }, !disabled && kind === 'secondary' && { borderColor: colors.accent }, style]}
      labelStyle={styles.buttonText}
    >
      {label}
    </PaperButton>
  );
}

// Paper's outlined text field. Borders and padding come from Paper; a style's minHeight and fontSize are kept.
export function TextInput({ style, ...props }) {
  const { minHeight, fontSize, flex } = StyleSheet.flatten(style) ?? {};
  return (
    <PaperTextInput
      mode="outlined"
      dense={!props.multiline}
      outlineColor={colors.line}
      activeOutlineColor={colors.accent}
      textColor={colors.text}
      placeholderTextColor={colors.placeholder}
      {...props}
      style={[{ backgroundColor: colors.bg, fontSize: fontSize ?? 15 }, minHeight && { minHeight }, flex && { flex }]}
      contentStyle={{ fontFamily: 'Inter_400Regular', ...(props.multiline && { paddingTop: 12, paddingBottom: 12 }) }}
    />
  );
}

// A short message at the bottom of the screen, e.g. "Copy made". useToast()(message) shows it.
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [message, setMessage] = useState('');
  const show = useCallback((text) => setMessage(text), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar visible={Boolean(message)} onDismiss={() => setMessage('')} duration={4000} style={styles.toast}
        action={{ label: 'OK', onPress: () => setMessage('') }}>
        {message}
      </Snackbar>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  buttonText: { fontSize: 15, fontFamily: 'Inter_500Medium', fontWeight: 'normal' },
  // Above the tab bar.
  toast: { marginBottom: 80 },
});
