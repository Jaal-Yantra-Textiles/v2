/**
 * Theme configuration for the Medusa storefront app.
 * Customized colors following the Medusa tutorial.
 */

import { Platform } from 'react-native';

// Primary brand colors
const primaryLight = '#7C3AED'; // Purple - matches Medusa brand
const primaryDark = '#A78BFA';

// Secondary/accent colors
const secondaryLight = '#059669'; // Emerald for success states
const secondaryDark = '#34D399';

export const Colors = {
  light: {
    text: '#1F2937',
    textSecondary: '#6B7280',
    background: '#FFFFFF',
    backgroundSecondary: '#F9FAFB',
    tint: primaryLight,
    icon: '#9CA3AF',
    tabIconDefault: '#9CA3AF',
    tabIconSelected: primaryLight,
    border: '#E5E7EB',
    success: secondaryLight,
    error: '#DC2626',
    warning: '#F59E0B',
    card: '#FFFFFF',
    overlay: 'rgba(0, 0, 0, 0.5)',
    imagePlaceholder: '#F3F4F6',
  },
  dark: {
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    background: '#111827',
    backgroundSecondary: '#1F2937',
    tint: primaryDark,
    icon: '#6B7280',
    tabIconDefault: '#6B7280',
    tabIconSelected: primaryDark,
    border: '#374151',
    success: secondaryDark,
    error: '#F87171',
    warning: '#FBBF24',
    card: '#1F2937',
    overlay: 'rgba(0, 0, 0, 0.7)',
    imagePlaceholder: '#374151',
  },
};

export type ColorScheme = keyof typeof Colors;
export type ThemeColors = typeof Colors.light;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
