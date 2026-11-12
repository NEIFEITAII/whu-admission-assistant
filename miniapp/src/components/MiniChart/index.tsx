import { useEffect, useRef } from 'react';
import { Canvas, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { ChartSpec } from '@/utils/answerFormat';
import styles from './index.module.scss';

const SERIES_COLORS = ['#1b7a4d', '#e8759c', '#4fa87e'];
const AXIS_COLOR = '#9aa39c';
const GRID_COLOR = '#e3e9e4';
const TEXT_COLOR = '#4a544d';

let uidCounter = 0;

// 轻量 canvas 图表：柱状 / 折线 / 饼图，无第三方依赖
export default function MiniChart({ spec }: { spec: ChartSpec }) {
  const canvasId = useRef(`minichart-${++uidCounter}`).current;
  const specRef = useRef(spec);
  specRef.current = spec;

  useEffect(() => {
    const draw = async () => {
      try {
        const query = Taro.createSelectorQuery();
        query
          .select(`#${canvasId}`)
          .fields({ node: true, size: true } as never)
          .exec((res: never[]) => {
            const info = res?.[0] as unknown as {
              node?: HTMLCanvasElement;
              width?: number;
              height?: number;
            } | undefined;
            if (!info?.node || !info.width || !info.height) return;
            const canvas = info.node;
            const dpr = (Taro.getSystemInfoSync().pixelRatio) || 2;
            canvas.width = info.width * dpr;
            canvas.height = info.height * dpr;
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            drawChart(ctx, info.width, info.height, specRef.current);
          });
      } catch {
        // 画图失败静默：外层保留原始 markdown 表格兜底
      }
    };
    const t = setTimeout(draw, 120);
    return () => clearTimeout(t);
  }, [spec, canvasId]);

  return (
    <View className={styles.wrap}>
      <Canvas
        type='2d'
        id={canvasId}
        canvasId={canvasId}
        className={styles.canvas}
        style={{ width: '100%', height: '480rpx' }}
      />
    </View>
  );
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: ChartSpec,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  if (spec.kind === 'pie') drawPie(ctx, w, h, spec);
  else drawAxisChart(ctx, w, h, spec);
}

// ---------- 柱状 / 折线 ----------
function drawAxisChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: ChartSpec,
) {
  const padL = 48;
  const padR = 14;
  const padT = 22;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const all = spec.series.flatMap((s) => s.values);
  let max = Math.max(...all);
  let min = Math.min(...all);
  if (spec.kind === 'line' && min > 0) min = 0;
  if (max === min) max = min + 1;
  const span = max - min;
  max += span * 0.12;
  if (min > 0 && spec.kind === 'bar') min = 0;

  // Y 轴刻度
  ctx.strokeStyle = GRID_COLOR;
  ctx.fillStyle = AXIS_COLOR;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const y = padT + plotH - (plotH * i) / ticks;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(formatNum(v), padL - 6, y);
  }

  // 类目轴标签（>6 个隔位显示）
  const n = spec.categories.length;
  const step = Math.ceil(n / 6);
  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = 'center';
  const catW = plotW / n;
  spec.categories.forEach((c, i) => {
    if (i % step !== 0) return;
    const label = c.length > 6 ? `${c.slice(0, 6)}…` : c;
    ctx.fillText(label, padL + catW * (i + 0.5), h - padB / 2);
  });

  const xAt = (i: number) => padL + catW * (i + 0.5);
  const yAt = (v: number) => padT + plotH - ((v - min) / (max - min)) * plotH;

  if (spec.kind === 'bar') {
    const groupW = catW * 0.62;
    const barW = groupW / spec.series.length;
    spec.series.forEach((s, si) => {
      ctx.fillStyle = SERIES_COLORS[si % SERIES_COLORS.length];
      s.values.forEach((v, i) => {
        const x = padL + catW * i + (catW - groupW) / 2 + barW * si;
        const y = yAt(v);
        ctx.fillRect(x, y, barW - 2, padT + plotH - y);
      });
    });
    // 柱顶数值：单系列时显示
    if (spec.series.length === 1 && n <= 8) {
      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = 'center';
      ctx.font = '10px sans-serif';
      spec.series[0].values.forEach((v, i) => {
        ctx.fillText(formatNum(v), xAt(i), yAt(v) - 8);
      });
    }
  } else {
    // 折线
    ctx.font = '10px sans-serif';
    spec.series.forEach((s, si) => {
      ctx.strokeStyle = SERIES_COLORS[si % SERIES_COLORS.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = xAt(i);
        const y = yAt(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = SERIES_COLORS[si % SERIES_COLORS.length];
      s.values.forEach((v, i) => {
        ctx.beginPath();
        ctx.arc(xAt(i), yAt(v), 3, 0, Math.PI * 2);
        ctx.fill();
      });
      // 数值标注：≤2 条线且点数 ≤8
      if (spec.series.length <= 2 && n <= 8) {
        ctx.fillStyle = TEXT_COLOR;
        ctx.textAlign = 'center';
        s.values.forEach((v, i) => {
          ctx.fillText(formatNum(v), xAt(i), yAt(v) - 10);
        });
      }
    });
  }

  // 图例（多系列）
  if (spec.series.length > 1) drawLegend(ctx, w, h, spec, padT - 14);
}

// ---------- 饼图 ----------
function drawPie(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: ChartSpec,
) {
  const values = spec.series[0].values;
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = w * 0.38;
  const cy = h / 2;
  const r = Math.min(w * 0.32, h * 0.38);
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    ctx.fillStyle = SERIES_COLORS[i % SERIES_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.closePath();
    ctx.fill();
    angle += sweep;
  });
  // 图例+数值
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  const lx = w * 0.72;
  const rowH = 20;
  const startY = Math.max(24, h / 2 - ((spec.categories.length - 1) * rowH) / 2);
  spec.categories.forEach((c, i) => {
    if (i > 9) return;
    const y = startY + i * rowH;
    ctx.fillStyle = SERIES_COLORS[i % SERIES_COLORS.length];
    ctx.fillRect(lx, y - 4, 10, 10);
    ctx.fillStyle = TEXT_COLOR;
    const pct = ((values[i] / total) * 100).toFixed(1);
    const label = c.length > 6 ? `${c.slice(0, 6)}…` : c;
    ctx.fillText(`${label} ${pct}%`, lx + 14, y);
  });
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  _w: number,
  _h: number,
  spec: ChartSpec,
  y: number,
) {
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  let x = 8;
  spec.series.forEach((s, i) => {
    ctx.fillStyle = SERIES_COLORS[i % SERIES_COLORS.length];
    ctx.fillRect(x, y - 4, 10, 10);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(s.name, x + 13, y);
    x += 16 + ctx.measureText(s.name).width + 12;
  });
}

function formatNum(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}w`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}
