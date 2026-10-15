// Small UI kit. Rules that keep every screen accessible and RTL-safe:
//  - only logical properties (start/end, paddingHorizontal) — never left/right
//  - every tap target is at least `minTapSize` tall
//  - fonts come from the current language's script
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePrefs } from '@/i18n';
import { minTapSize, radius, space, typeScale, useColors, useFontFamily, type TextVariant } from '@/theme';

// ---------- Text ----------

export interface AppTextProps {
  children: ReactNode;
  variant?: TextVariant;
  bold?: boolean;
  muted?: boolean;
  color?: string;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text';
  selectable?: boolean;
}

export function AppText({
  children,
  variant = 'body',
  bold,
  muted,
  color,
  center,
  style,
  numberOfLines,
  accessibilityRole,
  selectable,
}: AppTextProps) {
  const c = useColors();
  const { language } = usePrefs();
  const isBold = bold ?? (variant === 'title' || variant === 'heading');
  const fontFamily = useFontFamily(isBold);
  // Text engines pick a paragraph's direction from its first strong letter, so
  // an RTL sentence that starts with a Latin word ("IOU ...") would be laid out
  // LTR. A leading right-to-left mark pins the direction.
  const content =
    language.meta.dir === 'rtl' && (typeof children === 'string' || typeof children === 'number')
      ? `\u200F${children}`
      : children;
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      accessibilityRole={accessibilityRole ?? (variant === 'title' || variant === 'heading' ? 'header' : undefined)}
      style={[
        typeScale[variant],
        { color: color ?? (muted ? c.textMuted : c.text), fontFamily },
        // The system font (e.g. for Chinese) needs fontWeight; bundled fonts have a bold file.
        isBold && !fontFamily ? { fontWeight: '700' } : null,
        center ? { textAlign: 'center' } : null,
        style,
      ]}
    >
      {content}
    </Text>
  );
}

// ---------- Icons ----------

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Icon that flips horizontally in RTL when `directional` (arrows, chevrons,
 * "back"), so they point the way the layout flows.
 */
export function Icon({
  name,
  size = 24,
  color,
  directional,
}: {
  name: IconName;
  size?: number;
  color?: string;
  directional?: boolean;
}) {
  const c = useColors();
  return (
    <Ionicons
      name={name}
      size={size}
      color={color ?? c.text}
      style={directional && I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
    />
  );
}

// ---------- Screen ----------

export function Screen({
  children,
  scroll = true,
  footer,
  edges = ['bottom'],
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  edges?: ('top' | 'bottom')[];
}) {
  const c = useColors();
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenContent, { flex: 1 }]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.background }}>
      {body}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

// ---------- Button ----------

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const palette = {
    primary: { bg: c.primary, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    ghost: { bg: 'transparent', fg: c.primary, border: 'transparent' },
    danger: { bg: 'transparent', fg: c.danger, border: c.danger },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.55 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} color={palette.fg} /> : null}
          <AppText variant="label" bold color={palette.fg}>
            {title}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

// ---------- Text field ----------

export function TextField({
  label,
  error,
  hint,
  ltr,
  ...input
}: TextInputProps & { label: string; error?: string | null; hint?: string; ltr?: boolean }) {
  const c = useColors();
  const fontFamily = useFontFamily();
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="label" bold>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textMuted}
        {...input}
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: c.surface,
            borderColor: error ? c.danger : c.border,
            fontFamily,
          },
          // Phone numbers, emails and codes read left-to-right in every language.
          ltr ? { writingDirection: 'ltr' } : null,
          input.style,
        ]}
      />
      {error ? (
        <AppText variant="caption" color={c.danger} accessibilityRole="text">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// ---------- Lists ----------

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm }}>
      {title ? (
        <AppText variant="caption" bold muted style={{ paddingHorizontal: space.sm }}>
          {title}
        </AppText>
      ) : null}
      <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border }]}>{children}</View>
    </View>
  );
}

export function Row({
  title,
  value,
  onPress,
  icon,
  selected,
  subtitle,
  last,
  danger,
}: {
  title: string;
  value?: string;
  subtitle?: string;
  onPress?: () => void;
  icon?: IconName;
  /** Shows a check mark and marks the row as the selected radio option. */
  selected?: boolean;
  last?: boolean;
  /** Destructive action (delete account). */
  danger?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={selected !== undefined ? 'radio' : onPress ? 'button' : undefined}
      accessibilityState={selected !== undefined ? { checked: selected } : undefined}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
        pressed && { backgroundColor: c.surfaceAlt },
      ]}
    >
      {icon ? <Icon name={icon} color={danger ? c.danger : c.primary} /> : null}
      <View style={{ flex: 1 }}>
        <AppText variant="label" color={danger ? c.danger : undefined}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" muted>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="caption" muted numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </AppText>
      ) : null}
      {selected ? <Icon name="checkmark-circle" color={c.primary} /> : null}
      {onPress && selected === undefined ? <Icon name="chevron-forward" size={20} color={c.textMuted} directional /> : null}
    </Pressable>
  );
}

// ---------- Avatar ----------

export function Avatar({ name, uri, size = 56 }: { name: string; uri?: string | null; size?: number }) {
  const c = useColors();
  const initial = [...(name.trim() || '?')][0]!.toUpperCase();
  const box: ViewStyle & ImageStyle = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={box} accessibilityIgnoresInvertColors />;
  return (
    <View style={[box, { backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }]}>
      <AppText variant="heading" color={c.primary} style={{ fontSize: size * 0.42, lineHeight: size * 0.6 }}>
        {initial}
      </AppText>
    </View>
  );
}

export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' }) {
  const c = useColors();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: tone === 'error' ? c.surfaceAlt : c.primarySoft, borderColor: tone === 'error' ? c.danger : c.primarySoft }]}
    >
      <Icon name={tone === 'error' ? 'alert-circle-outline' : 'information-circle-outline'} color={tone === 'error' ? c.danger : c.primary} />
      <AppText variant="caption" style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space.md, gap: space.lg, flexGrow: 1 },
  footer: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  button: {
    minHeight: minTapSize,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  input: {
    minHeight: minTapSize,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 20,
  },
  section: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    minHeight: minTapSize + 8,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
