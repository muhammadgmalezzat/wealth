import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, type ColorToken } from '@/constants/theme';

import { useMeasuredWidth } from './common';
import { sparkLayout } from './seriesLayout';

const HEIGHT = 28;

interface SparklineProps {
  // Oldest first; null = a gap (nothing drawn there).
  values: (number | null)[];
  color: ColorToken;
  // The last value is still running: a hollow dot, not joined to the line.
  lastInProgress?: boolean;
}

// A tiny trend line inside a card: straight segments, gaps kept, time left to right like the other charts.
export function Sparkline({ values, color, lastInProgress = false }: SparklineProps) {
  const [width, onLayout] = useMeasuredWidth();
  const layout = sparkLayout(values, lastInProgress, width, HEIGHT);
  return (
    <View onLayout={onLayout} style={{ height: HEIGHT }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          {layout.lines.map((d, i) => (
            <Path key={`l${i}`} d={d} stroke={colors[color]} strokeWidth={1.5} fill="none" />
          ))}
          {layout.dots.map((p, i) => (
            <Circle key={`d${i}`} cx={p.x} cy={p.y} r={2} fill={colors[color]} />
          ))}
          {layout.hollow && <Circle cx={layout.hollow.x} cy={layout.hollow.y} r={2.5} stroke={colors[color]} strokeWidth={1.5} fill="none" />}
        </Svg>
      )}
    </View>
  );
}
