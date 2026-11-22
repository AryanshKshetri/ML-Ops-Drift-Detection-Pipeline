# MLOps Drift Detection Pipeline

An automated pipeline that serves a machine learning model, logs every prediction, monitors the incoming data for drift with several families of detectors, and shows the results on a live dashboard. Retraining and model promotion are part of the design and are demonstrated with simulated data. The research goal is an empirical comparison of drift detectors on synthetic drift with known ground truth, not a claim that one detector is best.

**Domain:** telecom customer churn, using the IBM Telco Customer Churn dataset.
**Project deadline:** 25 November 2026.

## What works today, and what is simulated

This section is the quickest way to understand the project's current state.

| Part | State |
|---|---|
| Prediction API with input validation and logging | **Real.** Node.js and Express, tested |
| Churn model (logistic regression) behind `/predict` | **Real.** Trained on the Telco data, served by a FastAPI service |
| TimescaleDB storage (7 tables) | **Real** |
| Dashboard (Drift, Performance, Retraining, Models) | **Real.** React and Vite, reads the API |
| Traffic and drift simulator with ground-truth logs | **Real** |
| Cloud deployment (Neon, Render, Vercel) | **Real**, with the caveats in the Deployment section |
| Drift scores, retraining events, model versions on the dashboard | **Simulated.** Written by `seed-monitoring.js` and `live-detector.js` |
| Drift detector implementations (KS, PSI, JS, Wasserstein, domain classifier, ADWIN, DDM) | **Planned** |
| Automated retraining, validation and promotion, MLflow registry | **Planned** |
| Benchmark of detectors against ground truth | **Planned** |

The simulated rows are demo data that behave like detector output, so the dashboard can show the full pipeline before the detectors exist. Do not read them as measurements of detector accuracy.

## Status by layer

| Layer | Owner | Status |
|---|---|---|
| Serving API (Node.js), validation and prediction logging | Backend | Working |
| TimescaleDB storage | Backend | Working |
| Dashboard read endpoints | Backend | Working |
| Traffic and drift simulator | Backend | Working |
| Monitoring dashboard (React and Vite) | Backend | Working |
| ML service (model training, `/predict`) | ML | Working, integrated |
| Drift detection algorithms | ML | Planned |
| Retraining workflow, model registry | ML | Planned |

## Architecture

```
Client / traffic simulator
          |
          v
Node.js API (Express, port 4000)
  POST /predict  --->  ML service (FastAPI, port 8000)  --->  saved_model/
          |
          v
PostgreSQL + TimescaleDB (port 5432)
  predictions, labels, detection_runs, drift_scores,
  detector_configs, retrain_events, model_versions
     ^                                   ^
     |                                   |
GET /api/... <---- Dashboard        scripts/seed-monitoring.js
                  (React, port 5173) scripts/live-detector.js
                                     (simulated detector output)
```

Every request that reaches `POST /predict` and passes validation is stored, including requests that fail because the ML service is down. Failed requests are stored with empty prediction fields, so drift detectors should ignore rows where `prediction IS NULL`. Requests that fail validation are rejected with a 400 and are not stored.

The dashboard never reads the database directly. It calls the API over HTTP and refreshes every 10 seconds.

## Repository layout

```
mlops-drift-pipeline/
├── backend-node/                Node.js API
│   ├── src/
│   │   ├── index.js             Express app and route mounting
│   │   ├── config.js            Environment variables
│   │   ├── db/
│   │   │   ├── pool.js          Shared Postgres connection pool
│   │   │   ├── schema.sql       predictions table and hypertable
│   │   │   └── schema_v2.sql    labels, drift, retraining and model tables
│   │   └── routes/
│   │       ├── predict.js       POST /predict (validation and logging)
│   │       ├── stats.js         Prediction volume and feature statistics
│   │       ├── monitoring.js    Drift, performance, retraining and model endpoints
│   │       ├── detectors.js     Detector settings
│   │       ├── labels.js        Delayed ground-truth labels
│   │       └── mockMl.js        Stand-in model, used by the cloud deployment
│   ├── scripts/
│   │   ├── simulate-traffic.js  Traffic and drift simulator
│   │   ├── seed-monitoring.js   Writes a 7-day demo timeline of drift data
│   │   ├── live-detector.js     Writes live demo drift data, with a key to start drift
│   │   └── runs/                Ground-truth logs from simulator runs
│   ├── package.json
│   └── .env.example
├── ml-service/                  Python ML service
│   ├── app/
│   │   ├── main.py              FastAPI endpoints
│   │   ├── model.py             Model loading and prediction
│   │   └── train.py             Training script
│   ├── saved_model/             Trained model files (git-ignored)
│   ├── requirements.txt
│   └── Dockerfile
├── dashboard/                   React and Vite dashboard
│   ├── src/
│   │   ├── api.js               API client (reads VITE_API_URL)
│   │   ├── pages/               Drift, Performance, Retraining, Models
│   │   └── components/          Layout and page header
│   ├── vercel.json              Route rewrite for the Vercel deployment
│   └── .env.example
├── data/
│   └── Telco-Customer-Churn.csv
├── docker-compose.yml           TimescaleDB, ML service and API
└── README.md
```

## Prerequisites

- Docker Desktop, running
- Node.js 20 or later (developed on Node.js 22), for the dashboard and the scripts
- Git

Python is not needed on your machine. The ML service is trained and served inside Docker.

The commands below are for Windows PowerShell, run from the repository root unless stated otherwise.

## Setup

### 1. Get the dataset

If `data/Telco-Customer-Churn.csv` is missing, download it:

```powershell
New-Item -ItemType Directory -Force data
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/IBM/telco-customer-churn-on-icp4d/master/data/Telco-Customer-Churn.csv" -OutFile data\Telco-Customer-Churn.csv
```

### 2. Train the model

The API needs a trained model before it can make predictions. Training runs inside Docker and takes under a minute.

```powershell
docker compose build ml-service
docker compose run --rm ml-service python -m app.train
```

It prints the metrics and writes `model.joblib`, `metadata.json` and `reference.csv` to `ml-service/saved_model/`. If the CSV has a different name, add `--data /data/<file>.csv` to the training command.

### 3. Start the stack

```powershell
docker compose up -d --build
docker compose ps
```

`docker compose ps` should list `mlops_timescaledb` (healthy), `mlops_ml` and `mlops_api`. The database tables are created automatically on the first start from `schema.sql` and `schema_v2.sql`. These scripts run only when the database volume is empty. To start from a clean database, run `docker compose down -v`, which deletes all stored data.

Check each service:

```powershell
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:8000/health
```

The ML service should answer `status: ok` with `model_version: v1`. The status `no_model` means training has not been run.

### 4. Start the dashboard

```powershell
cd dashboard
npm install
npm run dev
```

Open `http://localhost:5173`. The dashboard reads the API at `http://localhost:4000`. To use another API, copy `.env.example` to `.env` and set `VITE_API_URL`.

### 5. Fill the dashboard with data

Install the backend dependencies once and copy the environment file:

```powershell
cd ..\backend-node
Copy-Item .env.example .env
npm install
```

Check that `backend-node/.env` contains `DATABASE_URL=postgresql://mlops_user:mlops_pass@localhost:5432/mlops_db`. The scripts connect to the database directly, so this must point at the database you want to fill.

Write a 7-day demo timeline (this replaces the monitoring tables, but not `predictions`):

```powershell
node scripts/seed-monitoring.js --reset
```

Or run the live demo, where drift starts when you press a key:

```powershell
node scripts/live-detector.js --no-backfill --interval 5
```

| Key | Action |
|---|---|
| `d` | Start drift: scores climb above their thresholds and a retraining run starts |
| `c` | Clear drift: scores fall back to normal |
| `q` | Quit |

Options:

| Option | Meaning | Default |
|---|---|---|
| `--interval` | Seconds between runs | 10 |
| `--backfill` | Hours of calm history written first (`--no-backfill` skips it) | 24 |
| `--retrain-seconds` | How long a simulated retraining takes before promotion | 45 |
| `--drift-after` | Start drift automatically after this many seconds (for terminals without key input) | off |
| `--duration` | Stop automatically after this many seconds | off |

Open the dashboard on the 1h range and press `d` to watch the detectors cross their thresholds, a retraining run start, and a new model get promoted.

## Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | API, scripts | Postgres connection string |
| `PORT` | API | Port the API listens on (4000 locally) |
| `ML_SERVICE_URL` | API | Address of the ML service (`http://ml-service:8000` in Docker) |
| `ADMIN_API_KEY` | API | Key for the API's admin endpoints. Set your own value outside local development |
| `MODEL_DIR` | ML service | Folder holding the trained model (`/app/saved_model` in Docker) |
| `VITE_API_URL` | Dashboard | API address, read when the dashboard is built |

`.env` files are git-ignored. Never commit them.

## ML service

A FastAPI service wraps a logistic regression churn model (standard scaling for the numeric features, one-hot encoding for the categorical ones).

Request: `POST {ML_SERVICE_URL}/predict`

```json
{ "features": { "tenure": 12, "MonthlyCharges": 70.5, "Contract": "Month-to-month", "...": "all 19 fields" } }
```

Response:

```json
{ "prediction": 1, "probability": 0.82, "model_version": "v1" }
```

`probability` is the predicted chance of churn. The service also provides `GET /health` and `GET /model-info` (version, metrics and feature list). It answers 422 for missing or non-numeric fields.

### Training and results

The data is split 80/20, stratified on the churn label, with a fixed seed. The 11 customers with a blank `TotalCharges` are kept, with the value set to 0. Results on the 1,409 held-out customers:

| Metric | Value |
|---|---|
| Accuracy | 0.8055 |
| ROC-AUC | 0.8421 |
| F1 | 0.604 |
| Precision | 0.657 |
| Recall | 0.559 |

About 26.5% of customers churn, so the classes are imbalanced. At the 0.5 threshold the model misses roughly 44% of churners, which is typical for a simple baseline on this dataset.

### Retraining and versions

Train again under a new version name:

```powershell
docker compose run --rm ml-service python -m app.train --version v2
```

The service reloads the model file when it changes, so no restart is needed, and each prediction records the version that produced it. The files in `saved_model/` are git-ignored, except `metadata.json`.

## API reference

### `GET /health`

Returns `{ "status": "ok" }`.

### `POST /predict`

Body: `{ "features": { ... } }`. All 19 fields are required, with these values:

| Field | Allowed values |
|---|---|
| `tenure` | number, 0 to 100 |
| `MonthlyCharges` | number, 0 to 500 |
| `TotalCharges` | number, 0 to 20000 |
| `SeniorCitizen` | 0 or 1 |
| `gender` | Male, Female |
| `Partner`, `Dependents`, `PhoneService`, `PaperlessBilling` | Yes, No |
| `MultipleLines` | Yes, No, No phone service |
| `InternetService` | DSL, Fiber optic, No |
| `OnlineSecurity`, `OnlineBackup`, `DeviceProtection`, `TechSupport`, `StreamingTV`, `StreamingMovies` | Yes, No, No internet service |
| `Contract` | Month-to-month, One year, Two year |
| `PaymentMethod` | Electronic check, Mailed check, Bank transfer (automatic), Credit card (automatic) |

Example:

```powershell
$body = @'
{
  "features": {
    "gender": "Female", "tenure": 33, "Partner": "Yes", "Contract": "Two year",
    "Dependents": "No", "StreamingTV": "Yes", "TechSupport": "Yes",
    "OnlineBackup": "No", "PhoneService": "No", "TotalCharges": 2016.3,
    "MultipleLines": "No phone service", "PaymentMethod": "Bank transfer (automatic)",
    "SeniorCitizen": 0, "MonthlyCharges": 59.55, "OnlineSecurity": "Yes",
    "InternetService": "DSL", "StreamingMovies": "Yes", "DeviceProtection": "Yes",
    "PaperlessBilling": "No"
  }
}
'@
Invoke-RestMethod -Uri http://localhost:4000/predict -Method POST -ContentType "application/json" -Body $body
```

Success (200):

```json
{
  "request_id": "c74c8ac5-5913-48dd-ab65-ca0c6f88b304",
  "prediction": 0,
  "probability": 0.0457,
  "model_version": "v1",
  "created_at": "2026-11-22T22:46:25.698Z"
}
```

Errors:

| Status | Meaning |
|---|---|
| 400 | `features` is missing or not an object, or a value is invalid. The response lists each problem, for example `tenure must be a number` |
| 502 | The ML service returned an error |
| 503 | The ML service was unreachable or timed out |
| 500 | The prediction worked but logging to the database failed |

For 502 and 503 the request is still logged, with empty `prediction`, `probability` and `model_version`. A 400 is rejected before anything is logged.

### Prediction and monitoring endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/predictions/recent?limit=20` | Latest logged predictions, newest first (`limit` 1 to 200) |
| `GET /api/stats/volume?bucket_seconds=60&minutes=1440` | Request counts per time bucket: `total`, `failed` and `positive` |
| `GET /api/stats/features?from=<ISO>&to=<ISO>` | Summary statistics of the features inside one time window. Compare two windows to see drift by eye |
| `GET /api/drift/overview?minutes=` | Detectors alarming now, peak drift and alarm count |
| `GET /api/drift/scores?minutes=` | Drift score per detector over time |
| `GET /api/drift/features?minutes=&detector=` | Drift score per feature |
| `GET /api/retrain/events?minutes=` | Retraining runs and their outcomes |
| `GET /api/models/versions` | Model versions and their stage |
| `GET /api/performance?minutes=&bucket_hours=` | Accuracy, precision, recall and F1 from labelled predictions |
| `GET /api/detectors` | Detector settings and thresholds |
| `GET /api/labels/coverage` | Share of predictions that have a true label |

## Database schema

The database is `mlops_db`, PostgreSQL 16 with the TimescaleDB extension. `predictions` is a hypertable partitioned on `created_at`.

| Table | Purpose |
|---|---|
| `predictions` | Every logged request: `request_id`, `features` (jsonb), `prediction`, `probability`, `model_version`, `created_at`. Null prediction fields mean the ML service failed |
| `labels` | True churn outcomes that arrive after the prediction, linked to `predictions` |
| `detection_runs` | One row per detection window: `window_start`, `window_end`, `reference_size` (2000), `current_size` (200) |
| `drift_scores` | One row per detector per run: `detector_name`, optional `feature_name`, `score`, `drift_detected`, `compute_ms` |
| `detector_configs` | Detector `family`, `enabled`, `threshold` and `params` |
| `retrain_events` | Retraining runs: `trigger_type` (auto or manual), `status` (running, promoted, rejected, skipped, failed), `outcome`, start and finish time |
| `model_versions` | Versions with `stage` (shadow, production, archived) and `validation_metric` |

Default detector thresholds:

| Detector | Family | Alarm condition |
|---|---|---|
| KS test | Statistical | statistic above 0.15 |
| PSI | Statistical | PSI above 0.25 |
| Jensen-Shannon divergence | Distance | above 0.08 |
| Wasserstein distance | Distance | above 0.12 |
| Domain classifier | ML-based | AUC above 0.70 |
| ADWIN (delta 0.002), DDM | Streaming | binary alarm, no score threshold |

## Dashboard

| Page | Question it answers |
|---|---|
| Drift | Has the incoming data changed? One line per detector, as a multiple of its threshold, with alarm periods marked, plus per-feature drift and recent retraining events |
| Performance | Is the model still accurate? Accuracy, F1, precision and recall over time, and a confusion matrix, from labelled predictions |
| Retraining | When did the system retrain, and what happened? A timeline and table of runs, with the trigger detector, score, duration and outcome |
| Models | Which model versions exist? The production version, all versions with their stage, and a validation comparison |

The time buttons (1h, 24h, 7d, 30d) set how far back the pages look. The Models page does not use them.

## Dataset

The pipeline uses the IBM Telco Customer Churn CSV (7,043 customers, 21 columns). Use this 21-column file, not the 33-column IBM variant on Kaggle. IBM publishes it as a sample dataset and states no licence on it, so it is used here for academic purposes.

The 19 features are the columns other than `customerID` and `Churn` (`Churn` is the label). A few new customers have a blank `TotalCharges`. The model trains on them with the value set to 0. The simulator skips them, because the API rejects blank values.

## Traffic and drift simulator

The simulator samples real customers from the CSV and sends them to `POST /predict`. In drift scenarios it modifies part of the stream.

```powershell
cd backend-node
node scripts/simulate-traffic.js --count 400 --scenario price_hike --pattern sudden --seed 42
```

| Option | Values | Default |
|---|---|---|
| `--count` | Number of requests | 400 |
| `--scenario` | `baseline`, `price_hike`, `contract_shift`, `new_customers` | `baseline` |
| `--pattern` | `sudden`, `gradual`, `recurring` | `sudden` |
| `--seed` | Any integer, for reproducible runs | 42 |
| `--delay` | Milliseconds between requests | 20 |
| `--url` | API URL | `http://localhost:4000/predict` |

Scenarios:

- `baseline`: no drift.
- `price_hike`: `MonthlyCharges` and `TotalCharges` rise by 35% (covariate drift).
- `contract_shift`: about 70% of drifted customers move to month-to-month contracts.
- `new_customers`: drifted traffic comes mostly from customers with 12 months of tenure or less.

Patterns control when drift happens: `sudden` switches at the halfway point, `gradual` ramps up between 40% and 70% of the run, and `recurring` drifts in two separate periods.

The simulator checks that the API is reachable before it starts. Each run writes a ground-truth log to `backend-node/scripts/runs/`, with one row per request: its position, send time, whether it was drifted, the request id, and the customer's real churn label. Detection latency is measured against the first drifted row in this file.

All scenarios change input features only. Testing concept drift needs delayed labels, which are not part of the simulator yet.

To start a clean experiment, empty the table first:

```powershell
docker exec -i mlops_timescaledb psql -U mlops_user -d mlops_db -c "TRUNCATE predictions;"
```

## Deployment

The project is deployed on free tiers:

| Part | Host | Notes |
|---|---|---|
| Database | Neon | PostgreSQL with the TimescaleDB extension, created from `schema.sql` and `schema_v2.sql` |
| API | Render (web service, root directory `backend-node`) | Build `npm install`, start `npm start` |
| Dashboard | Vercel (root directory `dashboard`) | Needs `VITE_API_URL` set to the API address, then a redeploy |

Render environment variables: `DATABASE_URL` (the Neon connection string), `PORT=10000`, `ML_SERVICE_URL=http://localhost:10000/mock-ml` and `ADMIN_API_KEY`. The API is at `https://ml-ops-drift-detection-pipeline.onrender.com`.

Things to know about the cloud version:

- It uses the built-in mock model (`mock-v0`), because the ML service runs only in the local Docker stack.
- Its dashboard data is the simulated demo data from the scripts.
- Render's free service sleeps when idle, so the first request takes 30 to 50 seconds.
- Neon's free plan has a monthly compute limit. Run `live-detector.js` against it only during a demo.
- To feed the cloud database, set `DATABASE_URL` in `backend-node/.env` to the Neon string, run the script, then change it back. Check the host before each run.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `docker : The term 'docker' is not recognized` | Docker Desktop is not installed or not on PATH. Install it and restart. |
| ML service health says `no_model`, or `/predict` returns 503 | The model has not been trained. Run `docker compose run --rm ml-service python -m app.train`, then check that `ml-service/saved_model/model.joblib` exists. |
| `/predict` returns 400 | A feature is missing or has a value outside the allowed list. The response names each field. |
| `curl` reports `Empty reply from server` right after a rebuild | The API is still restarting. Wait 10 seconds and retry. |
| `failed to read dockerfile` | `ml-service/Dockerfile` is missing, empty or saved as `Dockerfile.txt`. |
| `EADDRINUSE` on port 4000 when running `npm run dev` | The Docker API already uses the port. Stop it with `docker compose stop api`, or use `$env:PORT = 4001`. |
| Dashboard says `Cannot reach the API` | The API is not running, or the dashboard was built without `VITE_API_URL`. On Vercel, set it and redeploy. |
| Dashboard says `No drift scores in this time range` | The monitoring tables are empty. Run `node scripts/seed-monitoring.js --reset`. |
| A script fills the wrong database | The scripts use `DATABASE_URL` from `backend-node/.env`. Check whether the host is `localhost` or a cloud address before running. |
| Performance page looks odd | It uses only labelled predictions, and older rows come from the mock model. |
| `Unable to connect to the remote server` when calling the API | The API is not running. Run `docker compose up -d`. |
| `<` is rejected when loading SQL | PowerShell does not support input redirection. Use `Get-Content file.sql \| docker exec -i ...`. |

## Known limitations

- The drift detectors, the retraining workflow and MLflow are not implemented. The dashboard shows simulated output for them.
- The model is a simple baseline. Recall is moderate (0.559).
- The `/predict` endpoint has no authentication and the API accepts requests from any origin, which is acceptable for a demo but not for production.
- The cloud deployment uses the mock model.
- The simulator changes input features only.

## Team

| Name | Roll No. | Area |
|---|---|---|
| `Atharv Untwale` | `EN23CS301222` | Backend (Node.js), database, dashboard, deployment |
| `Aryansh Kshetri` | `EN23CS301207` | ML service, drift detection, retraining |

Guide: `Prof. Shrikant Telang`. Medicaps University, Department of Computer Science and Engineering.

## Roadmap

1. Drift detectors: KS test, PSI, Jensen-Shannon, Wasserstein, domain classifier, ADWIN and DDM, reading `ml-service/saved_model/reference.csv` and the live predictions.
2. Retraining workflow with validation, shadow deployment and promotion, and MLflow versioning.
3. Delayed labels, so that performance and concept drift can be measured.
4. Benchmark runs against the simulator's ground-truth logs, and the comparative analysis report.
5. Deploy the ML service to the cloud.