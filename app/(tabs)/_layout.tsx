import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { colors, size, type, space } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: colors.primary700,
        tabBarInactiveTintColor: colors.textSecondary,
        // Size and weight from type.micro; no fixed lineHeight (it clips Arabic glyphs inside the
        // fixed-height bar).
        tabBarLabelStyle: { fontSize: type.micro.fontSize, fontWeight: type.micro.fontWeight },
        // Flat bar on the warm ground: hairline top border, no shadow.
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          shadowOpacity: 0,
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
        name="assets"
        options={{
          title: 'الأصول',
          tabBarIcon: ({ color }) => <IconSymbol size={size.icon} name="wallet.pass" color={color} />,
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
