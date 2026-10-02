import { useColorScheme as useRNColorScheme } from 'react-native';

// React Native's ColorSchemeName also includes null and 'unspecified'; both mean light here.
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
