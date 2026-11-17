import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import PageHeader from "../components/PageHeader.jsx";
import { Card, Kpi, Chip, Notice } from "../components/ui.jsx";
import { fmtDayClock } from "../lib/format.js";

const REFRESH_MS = 10000;
const STAGE_COLORS = { production: "#2e8b80", shadow: "#2c4a7a", archived: "#80858d" };
const when = (iso) => (iso ? fmtDayClock(new Date(iso).getTime()) : "\u2013");

const source = (v) =>
  !v.retrain_event_id ? "initial model" : `${v.trigger_type === "manual" ? "manual" : "auto"} retrain \u00b7 ${v.event_status ?? "unknown"}`;

export default function Models() {
  const m = useApi((s) => api.modelVersions(s), [], REFRESH_MS);
  const versions = m.data?.versions ?? [];
  const production = m.data?.production ?? null;
  const shadow = m.data?.shadow ?? null;
  const archived = versions.filter((v) => v.stage === "archived").length;
  const best = versions.filter((v) => v.validation_metric !== null).sort((a, b) => b.validation_metric - a.validation_metric)[0];
  const status = !m.data ? null : production ? { color: "#2e8b80", text: `${production.model_version} in production` } : { color: "#80858d", text: "No model" };

  return (
    <>
      <PageHeader title="Models" sub="Telco churn · versions registered by the retraining workflow" status={status} noRange />
      {m.error && <Notice error={m.error} onRetry={m.reload} />}
      {m.data && versions.length === 0 && !m.error && (
        <Notice>
          No model versions yet. For demo data run <code>node scripts/seed-monitoring.js --reset</code> in backend-node.
        </Notice>
      )}

      <div className="grid-kpi">
        <Kpi label="Production model" value={production ? production.model_version : "\u2013"} note={production ? `since ${when(production.created_at)}` : "none promoted yet"} />
        <Kpi label="Candidate in shadow" value={shadow ? shadow.model_version : "None"} note={shadow ? `registered ${when(shadow.created_at)}` : "no candidate being compared"} />
        <Kpi label="Versions registered" value={m.data ? versions.length : "\u2013"} note={`${archived} archived`} />
        <Kpi label="Best validation F1" value={best ? best.validation_metric.toFixed(2) : "\u2013"} note={best ? `${best.model_version}` : "no metrics yet"} />
      </div>

      <div className="grid-main" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px", alignItems: "start" }}>
        <Card>
          <div className="lab" style={{ marginBottom: 12 }}>Version history</div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Stage</th>
                  <th>Registered</th>
                  <th>Validation F1</th>
                  <th>Source</th>
                  <th>MLflow run</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.model_version}>
                    <td><span className="ver">{v.model_version}</span></td>
                    <td><Chip color={STAGE_COLORS[v.stage]}>{v.stage}</Chip></td>
                    <td className="m">{when(v.created_at)}</td>
                    <td className="m b">{v.validation_metric === null ? "\u2013" : v.validation_metric.toFixed(2)}</td>
                    <td className="m">{source(v)}</td>
                    <td className="m">{v.mlflow_run_id ?? "\u2013"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div className="lab" style={{ marginBottom: 14 }}>Validation F1 by version</div>
          {versions.length === 0 && <div className="empty" style={{ padding: "30px 0" }}>No versions yet.</div>}
          {[...versions].reverse().map((v) => (
            <div className="vbar" key={v.model_version}>
              <span className="ver small">{v.model_version}</span>
              <div className="track">
                <div className="fill" style={{ width: `${(v.validation_metric ?? 0) * 100}%`, background: STAGE_COLORS[v.stage] }} />
              </div>
              <span className="mono-small">{v.validation_metric === null ? "\u2013" : v.validation_metric.toFixed(2)}</span>
            </div>
          ))}
          <p className="muted-note">
            Promoting, rejecting and rolling back versions from this page will be added together with the retraining workflow.
          </p>
        </Card>
      </div>
    </>
  );
}