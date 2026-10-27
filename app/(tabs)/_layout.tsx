import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { colors, radius, size, type, space } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        // Size and weight from type.micro; no fixed lineHeight (it clips Arabic glyphs inside the
        // fixed-height bar).
        tabBarLabelStyle: { fontSize: type.micro.fontSize, fontWeight: type.micro.fontWeight },
        // A floating glass bar: it stays in the layout (content never slides under it, so it can't cover
        // lists or the add button) but is inset from the screen edges and drawn as a rounded glass
        // surface (the fill and hairline come from tabBarBackground).
        tabBarBackground: () => <GlassSurface variant="strong" radius={radius.xl} style={StyleSheet.absoluteFill} />,
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          shadowOpacity: 0,
          marginHorizontal: space.md,
          marginBottom: space.sm,
          borderRadius: radius.xl,
          // Web has no bottom inset, so the default 48px bar clips the Arabic labels' descent.
          ...(Platform.OS === 'web' ? { height: 58, paddingBottom: space.xs + space.xxs } : null),
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'الرئيسية',
          tabBarIcon: ({ color }) => <IconSymbol size={size.icon} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'المعاملات',
          tabBarIcon: ({ color }) => <IconSymbol size={size.icon} name="list.bullet.rectangle" color={color} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'الخطة',
          tabBarIcon: ({ color }) => <IconSymbol size={size.icon} name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'التحليلات',
          tabBarIcon: ({ color }) => <IconSymbol size={size.icon} name="chart.bar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'الصناديق',
          tabBarIcon: ({ color }) => <IconSymbol size={size.icon} name="target" color={color} />,
        }}
      />
    </Tabs>
  );
}
