import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/ui/AppText';
import { formatMoney } from '@/components/ui/formatMoney';
import { ListGroup, ListRow } from '@/components/ui/ListRow';
import { colors, opacity, radius, space, type as typeScale } from '@/constants/theme';
import type { DisplayCurrency, FlowNode, SpendingFlow } from '@/store/analytics';
import { formatPercent } from '@/utils/formatters';

import { compactNumber, FLOW_COLOR, MIN_SANKEY_WIDTH, stackedFlowSegments, truncateLabel } from './analyticsUi';
import { useMeasuredWidth } from './common';
import { layoutSankey, type PlacedNode } from './sankeyLayout';

interface SankeyChartProps {
  flow: SpendingFlow;
  currency: DisplayCurrency;
  onNodePress: (node: FlowNode) => void;
}

// The picture is mirrored (money enters on the right), so `left` is the space for the source labels on the right
// and `right` the space for the category labels on the left.
const MARGINS = { left: 76, right: 104, top: 8, bottom: 8 };
const LABEL_SIZE = typeScale.micro.fontSize;
const ROW_HEIGHT = 26;
const MIN_HEIGHT = 280;

// Where the money went: sources → buckets / funds / gold / surplus → top categories, drawn with
// d3-sankey's geometry in react-native-svg. On a container too narrow for its labels it falls
// back to one stacked bar plus a list. Tapping a node reports it (the screen opens the
// transactions behind it).
export function SankeyChart({ flow, currency, onNodePress }: SankeyChartProps) {
  const [width, onLayout] = useMeasuredWidth();
  return (
    <View onLayout={onLayout}>
      {width === 0 ? (
        <View style={styles.placeholder} />
      ) : width < MIN_SANKEY_WIDTH ? (
        <StackedFlow flow={flow} currency={currency} onNodePress={onNodePress} />
      ) : (
        <Sankey flow={flow} width={width} currency={currency} onNodePress={onNodePress} />
      )}
    </View>
  );
}

function Sankey({ flow, width, currency, onNodePress }: { flow: SpendingFlow; width: number; currency: DisplayCurrency; onNodePress: (node: FlowNode) => void }) {
  const layout = useMemo(() => {
    // Tall enough for the busiest column (usually the categories).
    const perColumn = new Map<string, number>();
    for (const n of flow.nodes) {
      const key = n.kind === 'source' ? 's' : n.kind === 'category' ? 'c' : 'm';
      perColumn.set(key, (perColumn.get(key) ?? 0) + 1);
    }
    const height = Math.max(MIN_HEIGHT, Math.max(...perColumn.values()) * ROW_HEIGHT + MARGINS.top + MARGINS.bottom);
    return { height, ...layoutSankey(flow, width, height, MARGINS) };
  }, [flow, width]);

  const fill = (node: FlowNode) => colors[FLOW_COLOR[node.group]];
  const tappable = (node: FlowNode) => node.drill !== null || node.id === 'dest:funds';

  const label = (p: PlacedNode) => {
    const { node } = p;
    const height = p.y1 - p.y0;
    const cy = (p.y0 + p.y1) / 2;
    const name = truncateLabel(node.label, 13);
    const value = compactNumber(node.value);
    const common = { fontSize: LABEL_SIZE };
    if (p.column === 1) {
      // Middle column: a chip over the node and the ribbons, so it never needs side space.
      const x = (p.x0 + p.x1) / 2;
      const text = height >= 30 ? name : `${name} ${value}`;
      return (
        <>
          <SvgText {...common} x={x} y={cy + (height >= 30 ? -2 : 4)} textAnchor="middle" fill={colors.surface} stroke={colors.surface} strokeWidth={3.5} strokeLinejoin="round">
            {text}
          </SvgText>
          <SvgText {...common} x={x} y={cy + (height >= 30 ? -2 : 4)} textAnchor="middle" fill={colors.text} fontWeight="600">
            {text}
          </SvgText>
          {height >= 30 && (
            <>
              <SvgText {...common} x={x} y={cy + 12} textAnchor="middle" fill={colors.surface} stroke={colors.surface} strokeWidth={3.5} strokeLinejoin="round">
                {value}
              </SvgText>
              <SvgText {...common} x={x} y={cy + 12} textAnchor="middle" fill={colors.textSecondary}>
                {value}
              </SvgText>
            </>
          )}
        </>
      );
    }
    // Sources on the right of their node, categories on the left of theirs.
    const onRight = p.column === 0;
    const x = onRight ? p.x1 + 6 : p.x0 - 6;
    const anchor = onRight ? 'start' : 'end';
    return height >= 26 ? (
      <>
        <SvgText {...common} x={x} y={cy - 2} textAnchor={anchor} fill={colors.text} fontWeight="600">
          {name}
        </SvgText>
        <SvgText {...common} x={x} y={cy + 12} textAnchor={anchor} fill={colors.textSecondary}>
          {value}
        </SvgText>
      </>
    ) : (
      // Too thin for two lines: the name only (the amount is one tap away).
      <SvgText {...common} x={x} y={cy + 4} textAnchor={anchor} fill={colors.text}>
        {name}
      </SvgText>
    );
  };

  // Taps go through plain views over the picture: SVG press handlers don't work on the web.
  const hit = (p: PlacedNode) => {
    const left = p.column === 0 ? p.x0 - 4 : p.column === 2 ? p.x0 - MARGINS.right + 6 : p.x0 - 14;
    const right = p.column === 0 ? p.x1 + MARGINS.left - 4 : p.column === 2 ? p.x1 + 4 : p.x1 + 14;
    const cy = (p.y0 + p.y1) / 2;
    const height = Math.max(24, p.y1 - p.y0);
    return { left, top: cy - height / 2, width: right - left, height };
  };

  return (
    <View style={{ width, height: layout.height }}>
    <Svg width={width} height={layout.height} accessibilityLabel="فلوسك راحت فين">
      {layout.links.map((l, i) => (
        <Path
          key={`${l.source.node.id}-${l.target.node.id}-${i}`}
          d={l.path}
          fill="none"
          stroke={fill(l.target.node)}
          strokeOpacity={0.4}
          strokeWidth={l.width}
        />
      ))}
      {layout.nodes.map((p) => (
        <Rect
          key={p.node.id}
          x={p.x0}
          y={p.y0}
          width={p.x1 - p.x0}
          height={Math.max(1, p.y1 - p.y0)}
          rx={2}
          fill={fill(p.node)}
        />
      ))}
      {layout.nodes.map((p) => (
        <Label key={`l-${p.node.id}`}>{label(p)}</Label>
      ))}
    </Svg>
      {layout.nodes
        .filter((p) => tappable(p.node))
        .map((p) => (
          <Pressable
            key={`t-${p.node.id}`}
            onPress={() => onNodePress(p.node)}
            accessibilityRole="button"
            accessibilityLabel={`${p.node.label}، ${formatMoney(p.node.value, currency)}`}
            style={({ pressed }) => [styles.hit, hit(p), pressed && styles.hitPressed]}
          />
        ))}
    </View>
  );
}

// A fragment wrapper so each node's label has its own key.
function Label({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function StackedFlow({ flow, currency, onNodePress }: SankeyChartProps) {
  const segments = stackedFlowSegments(flow);
  return (
    <View style={styles.stacked}>
      <View style={styles.bar} accessibilityRole="image" accessibilityLabel="توزيع فلوسك">
        {segments.map(({ node, pct }) => (
          <Pressable
            key={node.id}
            onPress={() => onNodePress(node)}
            style={({ pressed }) => [{ flex: pct, backgroundColor: fillOf(node) }, pressed && { opacity: opacity.pressed }]}
          />
        ))}
      </View>
      <ListGroup>
        {segments.map(({ node, pct }) => (
          <ListRow
            key={node.id}
            title={node.label}
            subtitle={formatPercent(pct)}
            subtitleLines={1}
            trailing={<AppText variant="moneyRow">{formatMoney(node.value, currency)}</AppText>}
            icon={node.group === 'gold' ? 'diamond' : 'circle'}
            iconTone={node.group === 'gold' ? 'gold' : 'neutral'}
            iconColor={FLOW_COLOR[node.group]}
            onPress={() => onNodePress(node)}
          />
        ))}
      </ListGroup>
    </View>
  );
}

const fillOf = (node: FlowNode) => colors[FLOW_COLOR[node.group]];

const styles = StyleSheet.create({
  placeholder: { height: MIN_HEIGHT },
  hit: { position: 'absolute' },
  hitPressed: { backgroundColor: colors.primarySoft, borderRadius: radius.sm },
  stacked: { gap: space.md },
  // RTL: the first segment on the right.
  bar: { flexDirection: 'row-reverse', height: 18, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceSubtle },
});
