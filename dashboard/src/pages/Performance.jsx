import { useMemo } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { useRange } from "../components/Layout.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { Card, Kpi, Notice } from "../components/ui.jsx";
import { makeTicks, tickFormatter, fmtDayClock } from "../lib/format.js";

const REFRESH_MS = 10000;
const MIN_LABELLED = 10; // buckets with fewer labels are too noisy to plot
const ACC = "#15171c";
const F1 = "#2c4a7a";
const REC = "#2e8b80";
const PREC = "#b58a2a";
const axisTick = { fontFamily: "Geist Mono, monospace", fontSize: 10, fill: "#5e636b" };

const bucketHoursFor = (minutes) => (minutes <= 1440 ? 1 : minutes <= 10080 ? 6 : 24);
const pct = (v, d = 0) => (v === null || v === undefined ? "\u2013" : `${(v * 100).toFixed(d)}%`);
const dec = (v) => (v === null || v === undefined ? "\u2013" : v.toFixed(2));

function PerfTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tt">
      <div className="h">{fmtDayClock(label)}</div>
      <div className="r"><span>Accuracy</span><span>{dec(p.accuracy)}</span></div>
      <div className="r"><span>F1 score</span><span>{dec(p.f1)}</span></div>
      <div className="r"><span>Labelled</span><span>{p.labelled} / {p.requests}</span></div>
    </div>
  );
}

function Mini({ rows, lines, domain, fmt }) {
  if (rows.length < 2) return <div className="empty" style={{ padding: "40px 0" }}>Not enough data.</div>;
  return (
    <ResponsiveContainer width="100%" height={130}>
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
        <YAxis domain={domain} tickFormatter={fmt} tick={axisTick} axisLine={false} tickLine={false} width={40} tickCount={3} />
        <CartesianGrid stroke="#dcd8ce" vertical={false} />
        <Tooltip content={<PerfTooltip />} />
        {lines.map((l) => (
          <Line key={l.key} dataKey={l.key} stroke={l.color} strokeWidth={1.7} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function Matrix({ c }) {
  const n = c.tp + c.fp + c.fn + c.tn;
  if (n === 0) return <div className="empty" style={{ padding: "40px 0" }}>No labelled predictions yet.</div>;
  const cell = (v, good) => {
    const share = v / n;
    const bg = good ? `rgba(46,139,128,${0.18 + share * 1.1})` : `rgba(217,79,43,${0.1 + share * 1.6})`;
    return (
      <div className="cm-cell" style={{ background: bg }}>
        {pct(share)}
        <small>{v}</small>
      </div>
    );
  };
  return (
    <div className="cm">
      <div />
      <div className="lab">pred. stay</div>
      <div className="lab">pred. churn</div>
      <div className="lab">actual stay</div>
      {cell(c.tn, true)}
      {cell(c.fp, false)}
      <div className="lab">actual churn</div>
      {cell(c.fn, false)}
      {cell(c.tp, true)}
    </div>
  );
}

export default function Performance() {
  const { minutes } = useRange();
  const perf = useApi((s) => api.performance(minutes, bucketHoursFor(minutes), s), [minutes], REFRESH_MS);
  const events = useApi((s) => api.retrainEvents(minutes, s), [minutes], REFRESH_MS);

  const view = useMemo(() => {
    const buckets = perf.data?.buckets ?? [];
    const rows = buckets.map((b) => {
      const ok = b.labelled >= MIN_LABELLED;
      return {
        t: new Date(b.bucket).getTime(),
        requests: b.requests,
        labelled: b.labelled,
        accuracy: ok ? b.accuracy : null,
        f1: ok ? b.f1 : null,
        precision: ok ? b.precision : null,
        recall: ok ? b.recall : null,
        positive: b.positive_rate,
      };
    });
    const vals = rows.flatMap((r) => [r.accuracy, r.f1]).filter((v) => v !== null);
    const rawLo = vals.length ? Math.min(...vals) - 0.05 : 0;
    const rawHi = vals.length ? Math.max(...vals) + 0.05 : 1;
    const step = rawHi - rawLo > 0.5 ? 0.2 : 0.1;
    const lo = Math.max(0, Math.floor(rawLo / step) * step);
    const hi = Math.min(1, Math.ceil(rawHi / step) * step);
    const yTicks = [];
    for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push(Number(v.toFixed(2)));
    const low = rows.filter((r) => r.accuracy !== null).sort((a, b) => a.accuracy - b.accuracy)[0];
    const maxReq = Math.max(1, ...rows.map((r) => r.requests));
    const markers = (events.data?.events ?? [])
      .filter((e) => e.status === "promoted" && e.finished_at)
      .map((e) => ({ t: new Date(e.finished_at).getTime(), label: `${e.model_version ?? "model"} promoted` }))
      .filter((m) => rows.length > 1 && m.t >= rows[0].t && m.t <= rows[rows.length - 1].t);
    return { rows, lo, hi, yTicks, low, maxReq, markers };
  }, [perf.data, events.data]);

  const totals = perf.data?.totals;
  const firstError = perf.error ?? events.error;
  const { rows } = view;
  const min = rows[0]?.t;
  const max = rows[rows.length - 1]?.t;

  const status = !totals
    ? null
    : totals.labelled === 0
    ? { color: "#80858d", text: "No labels" }
    : { color: "#2e8b80", text: `${pct(totals.label_coverage)} labelled` };

  return (
    <>
      <PageHeader title="Performance" sub="Telco churn · metrics from delayed true labels" status={status} />
      {firstError && <Notice error={firstError} onRetry={() => { perf.reload(); events.reload(); }} />}
      {totals && totals.requests === 0 && !firstError && (
        <Notice>
          No predictions in this time range. Send traffic with <code>node scripts/simulate-traffic.js</code>, then labels
          with <code>node scripts/send-labels.js</code>, or run <code>node scripts/live-detector.js --predictions</code> for demo data.
        </Notice>
      )}

      <div className="grid-kpi">
        <Kpi label="Accuracy" value={dec(totals?.accuracy)} note={totals ? `${totals.labelled} labelled predictions in range` : ""} />
        <Kpi
          label="Lowest accuracy"
          value={view.low ? dec(view.low.accuracy) : "\u2013"}
          note={view.low ? `${fmtDayClock(view.low.t)}, ${view.low.labelled} labels` : `needs ${MIN_LABELLED}+ labels in a bucket`}
        />
        <Kpi label="Label coverage" value={totals?.label_coverage === null || !totals ? "\u2013" : pct(totals.label_coverage)} note="true outcomes arrive after a delay" />
        <Kpi label="Predicted churn rate" value={totals?.positive_rate === null || !totals ? "\u2013" : pct(totals.positive_rate)} note={totals ? `${totals.requests} predictions in range` : ""} />
      </div>

      <div style={{ marginTop: 18 }}>
        <Card>
          <div className="card-head">
            <div className="lab">Accuracy and F1 · {bucketHoursFor(minutes)} h buckets · labelled rows only</div>
            <div className="legend">
              <span><b style={{ background: ACC, height: 2.5 }} />accuracy</span>
              <span><b style={{ background: F1 }} />F1 score</span>
              <span><b style={{ background: "#c9cbce", height: 8 }} />requests</span>
            </div>
          </div>
          {rows.length < 2 ? (
            <div className="empty">{perf.loading && !perf.data ? "Loading\u2026" : "Not enough data to draw a trend. Try a longer range."}</div>
          ) : (
            <ResponsiveContainer width="100%" height={330}>
              <ComposedChart data={rows} margin={{ top: 24, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#dcd8ce" vertical={false} />
                <XAxis dataKey="t" type="number" domain={[min, max]} ticks={makeTicks(min, max)} tickFormatter={tickFormatter(min, max)} tick={axisTick} axisLine={{ stroke: "#15171c" }} tickLine={{ stroke: "#15171c" }} />
                <YAxis yAxisId="m" domain={[view.lo, view.hi]} ticks={view.yTicks} tickFormatter={(v) => v.toFixed(2)} tick={axisTick} axisLine={false} tickLine={false} width={44} />
                <YAxis yAxisId="v" domain={[0, view.maxReq * 5]} hide />
                <Bar yAxisId="v" dataKey="requests" fill="#c9cbce" barSize={Math.max(2, Math.min(10, 700 / rows.length))} isAnimationActive={false} />
                {view.markers.map((m) => (
                  <ReferenceLine
                    key={m.t}
                    yAxisId="m"
                    x={m.t}
                    stroke="#2e8b80"
                    label={{ value: m.label.toUpperCase(), position: (m.t - min) / (max - min) > 0.8 ? "insideTopRight" : "insideTopLeft", fill: "#2e8b80", fontSize: 9, fontFamily: "Geist Mono, monospace" }}
                  />
                ))}
                <Tooltip content={<PerfTooltip />} />
                <Line yAxisId="m" dataKey="f1" stroke={F1} strokeWidth={1.7} dot={false} isAnimationActive={false} />
                <Line yAxisId="m" dataKey="accuracy" stroke={ACC} strokeWidth={2.2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid-3">
        <Card>
          <div className="lab">Predicted churn rate · output drift</div>
          <div className="big">{pct(totals?.positive_rate)}</div>
          <Mini rows={rows} lines={[{ key: "positive", color: ACC }]} domain={[0, (dataMax) => Math.max(0.5, Math.ceil(dataMax * 10) / 10)]} fmt={(v) => `${Math.round(v * 100)}%`} />
        </Card>
        <Card>
          <div className="lab">Confusion matrix · labelled rows</div>
          {totals ? <Matrix c={totals.confusion} /> : <div className="empty">Loading…</div>}
        </Card>
        <Card>
          <div className="lab">Precision and recall</div>
          <div className="big">
            {dec(totals?.precision)} <small>precision</small> · {dec(totals?.recall)} <small>recall</small>
          </div>
          <Mini rows={rows} lines={[{ key: "precision", color: PREC }, { key: "recall", color: REC }]} domain={[0, 1]} fmt={(v) => v.toFixed(1)} />
        </Card>
      </div>
    </>
  );
}