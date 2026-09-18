import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export type AppTab = 'calendar' | 'schedule' | 'routines' | 'photos' | 'settings';

const TABS: { id: AppTab; glyph: string; label: string }[] = [
  { id: 'settings', glyph: '❀', label: 'Settings' },
  { id: 'calendar', glyph: '⌂', label: 'Home' },
  { id: 'schedule', glyph: '◷', label: 'Schedule' },
  { id: 'routines', glyph: '↻', label: 'Routines' },
  { id: 'photos', glyph: '▣', label: 'Photos' },
];

export function TabBar({ tab, onChange }: { tab: AppTab; onChange: (tab: AppTab) => void }) {
  return (
    <View pointerEvents="box-none" style={styles.rail} testID="floating-navbar">
      <View style={styles.bar}>
        {TABS.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            testID={`tab-${item.id}`}
            onPress={() => onChange(item.id)}
            style={[styles.item, tab === item.id && styles.itemOn]}
          >
            <Text style={[styles.glyph, tab === item.id && styles.glyphOn]}>{item.glyph}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 40,
  },
  bar: {
    flexDirection: 'column',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 16,
    padding: 2,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  item: {
    width: 32,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  itemOn: {
    backgroundColor: 'rgba(180,180,180,0.2)',
  },
  glyph: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 20,
  },
  glyphOn: {
    color: colors.ink,
    fontWeight: '700',
  },
});
