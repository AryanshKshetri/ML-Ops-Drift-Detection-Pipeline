import { useMemo, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { useRange } from "../components/Layout.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { Card, Kpi, Chip, Notice } from "../components/ui.jsx";
import { labelOf } from "../lib/detectors.js";
import { makeTicks, tickFormatter, fmtDayClock, fmtDuration } from "../lib/format.js";

const REFRESH_MS = 10000;
const COLORS = { promoted: "#2e8b80", rejected: "#b58a2a", skipped: "#80858d", failed: "#d94f2b", running: "#2c4a7a" };
const LABELS = { promoted: "Promoted", rejected: "Rejected", skipped: "Skipped", failed: "Failed", running: "Running" };

const triggerName = (e) => (e.trigger_type === "manual" ? "Manual" : e.detector_name ? labelOf(e.detector_name) : "Unknown");
const triggerNote = (e) => (e.trigger_type === "manual" ? "requested by an engineer" : e.feature_name ?? "overall score");
const score = (e) => (e.trigger_score === null || e.trigger_score === undefined ? "\u2013" : `${e.trigger_score} / ${e.trigger_threshold}`);

function Timeline({ events, minutes }) {
  const max = Date.now();
  const min = max - minutes * 60000;
  const ticks = makeTicks(min, max);
  const fmt = tickFormatter(min, max);
  const pos = (t) => `${((t - min) / (max - min)) * 100}%`;
  return (
    <div className="tl">
      <div className="tl-line" />
      {ticks.map((t) => (
        <div key={t} className="tl-tick" style={{ left: pos(t) }}>
          <i />
          <span>{fmt(t)}</span>
        </div>
      ))}
      {events.map((e) => {
        const t = new Date(e.started_at).getTime();
        if (t < min || t > max) return null;
        return (
          <div
            key={e.event_id}
            className="tl-dot"
            title={`${triggerName(e)} · ${LABELS[e.status]} · ${fmtDayClock(t)}`}
            style={{ left: pos(t), borderColor: COLORS[e.status], background: e.status === "promoted" ? COLORS.promoted : "#fbfaf7" }}
          />
        );
      })}
    </div>
  );
}

function Detail({ e }) {
  if (!e) return <div className="empty" style={{ padding: "60px 0" }}>Select a run to see its details.</div>;
  const rows = [
    ["Trigger", `${triggerName(e)} \u00b7 ${triggerNote(e)}`],
    ["Score / threshold", score(e)],
    ["Started", fmtDayClock(new Date(e.started_at).getTime())],
    ["Finished", e.finished_at ? fmtDayClock(new Date(e.finished_at).getTime()) : "still running"],
    ["Duration", fmtDuration(e.duration_seconds)],
    ["Model version", e.model_version ? `${e.model_version}${e.validation_metric !== null ? ` \u00b7 validation F1 ${e.validation_metric}` : ""}` : "none created"],
  ];
  return (
    <>
      <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 30, margin: "8px 0 6px" }}>
        {fmtDayClock(new Date(e.started_at).getTime()).slice(0, 6)}, {triggerName(e)}
      </div>
      <div style={{ marginBottom: 18 }}>
        <Chip color={COLORS[e.status]}>{LABELS[e.status]}</Chip>
      </div>
      {rows.map(([k, v]) => (
        <div className="kv" key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
      <div className="lab" style={{ marginTop: 18 }}>Outcome</div>
      <p style={{ marginTop: 6, lineHeight: 1.55 }}>{e.outcome ?? "No outcome recorded."}</p>
      <div className="mono-small">run {e.event_id.slice(0, 8)}</div>
      <p className="muted-note">Step-by-step timings will appear here once the orchestrator records them.</p>
    </>
  );
}

export default function Retraining() {
  const { minutes } = useRange();
  const ev = useApi((s) => api.retrainEvents(minutes, s), [minutes], REFRESH_MS);
  const [selected, setSelected] = useState(null);

  const events = ev.data?.events ?? [];
  const summary = ev.data?.summary;
  const current = useMemo(() => events.find((e) => e.event_id === selected) ?? events[0] ?? null, [events, selected]);

  const running = summary?.running ?? 0;
  const status = !summary ? null : running > 0 ? { color: COLORS.running, text: "Retraining" } : { color: "#80858d", text: "Idle" };

  return (
    <>
      <PageHeader title="Retraining" sub="Telco churn · automatic trigger when a detector crosses its threshold" status={status} />
      {ev.error && <Notice error={ev.error} onRetry={ev.reload} />}
      {summary && summary.total === 0 && !ev.error && <Notice>No retraining runs in this time range.</Notice>}

      <div className="grid-kpi">
        <Kpi label="Retraining runs" value={summary ? summary.total : "\u2013"} note="in the selected range" />
        <Kpi label="Promoted" value={summary ? summary.promoted : "\u2013"} note="new model went to production" />
        <Kpi label="Rejected or failed" value={summary ? summary.rejected + summary.failed : "\u2013"} note="production model kept" />
        <Kpi label="Skipped" value={summary ? summary.skipped : "\u2013"} note="a run was already pending" />
      </div>

      <div className="grid-main" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Card>
            <div className="lab">Events in range</div>
            <Timeline events={events} minutes={minutes} />
          </Card>
          <Card>
            <div className="lab" style={{ marginBottom: 12 }}>Retraining history</div>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Trigger</th>
                    <th>Score / thr.</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th>Version</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.event_id} className={current?.event_id === e.event_id ? "sel" : ""} onClick={() => setSelected(e.event_id)}>
                      <td className="m">{fmtDayClock(new Date(e.started_at).getTime())}</td>
                      <td>
                        <div>{triggerName(e)}</div>
                        <div className="lab" style={{ marginTop: 4, fontSize: 9 }}>{triggerNote(e)}</div>
                      </td>
                      <td className="m">{score(e)}</td>
                      <td className="m">{fmtDuration(e.duration_seconds)}</td>
                      <td><Chip color={COLORS[e.status]}>{LABELS[e.status]}</Chip></td>
                      <td className="m b">{e.model_version ?? "\u2013"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {events.length === 0 && !ev.loading && <div className="empty" style={{ padding: "40px 0" }}>Nothing to show.</div>}
            </div>
          </Card>
        </div>
        <Card>
          <div className="lab">Run detail</div>
          <Detail e={current} />
        </Card>
      </div>
    </>
  );
}