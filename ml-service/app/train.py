"""Train the baseline churn model on the IBM Telco dataset and save it.

Run from the ml-service folder:
    python -m app.train                       (looks for the CSV in ../data or /data)
    python -m app.train --data path/to/file.csv
    python -m app.train --version v2          (name stored with every prediction)

Writes three files to saved_model/:
    model.joblib     the fitted pipeline (preprocessing + logistic regression)
    metadata.json    version, training time, metrics, feature list
    reference.csv    the training features, for the drift detectors
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.model import CATEGORICAL, FEATURES, MODEL_DIR, NUMERIC

TARGET = "Churn"
THRESHOLD = 0.5
SEED = 42
OUT_DIR = MODEL_DIR


def find_csv():
    here = Path(__file__).resolve().parent.parent  # the ml-service folder
    for folder in (here.parent / "data", Path("/data"), Path("data")):
        if folder.is_dir():
            for f in sorted(folder.glob("*.csv")):
                if "churn" in f.name.lower():
                    return f
    return None


def load(path):
    df = pd.read_csv(path)
    missing = [c for c in FEATURES + [TARGET] if c not in df.columns]
    if missing:
        sys.exit(f"The CSV is missing columns: {missing}")
    # TotalCharges is blank for customers with tenure 0 (new customers).
    blank = pd.to_numeric(df["TotalCharges"], errors="coerce").isna().sum()
    df["TotalCharges"] = pd.to_numeric(df["TotalCharges"], errors="coerce").fillna(0.0)
    y = (df[TARGET].astype(str).str.strip() == "Yes").astype(int)
    return df[FEATURES].copy(), y, int(blank)


def build_pipeline():
    pre = ColumnTransformer(
        [
            ("num", StandardScaler(), NUMERIC),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
        ]
    )
    return Pipeline([("prep", pre), ("clf", LogisticRegression(max_iter=1000))])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", help="path to the Telco churn CSV")
    p.add_argument("--version", default="v1", help="model version label (default v1)")
    args = p.parse_args()

    path = Path(args.data) if args.data else find_csv()
    if path is None or not path.is_file():
        sys.exit("CSV not found. Pass it with --data path/to/file.csv")

    X, y, blank = load(path)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=SEED
    )

    model = build_pipeline()
    model.fit(X_train, y_train)

    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= THRESHOLD).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_test, pred).ravel()
    metrics = {
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "precision": round(float(precision_score(y_test, pred)), 4),
        "recall": round(float(recall_score(y_test, pred)), 4),
        "f1": round(float(f1_score(y_test, pred)), 4),
        "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT_DIR / "model.joblib")
    X_train.to_csv(OUT_DIR / "reference.csv", index=False)
    meta = {
        "model_version": args.version,
        "algorithm": "LogisticRegression (StandardScaler + OneHotEncoder)",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "data_file": path.name,
        "rows_total": int(len(X)),
        "rows_train": int(len(X_train)),
        "rows_test": int(len(X_test)),
        "blank_total_charges_set_to_zero": blank,
        "churn_rate": round(float(y.mean()), 4),
        "test_size": 0.2,
        "random_seed": SEED,
        "threshold": THRESHOLD,
        "features": FEATURES,
        "sklearn_version": sklearn.__version__,
        "metrics": metrics,
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))

    print(f"Trained {args.version} on {len(X_train)} rows, tested on {len(X_test)}.")
    print(f"Churn rate in data: {meta['churn_rate']:.1%}  (blank TotalCharges set to 0: {blank})")
    for k in ("accuracy", "precision", "recall", "f1", "roc_auc"):
        print(f"  {k:<10} {metrics[k]}")
    print(f"  confusion  {metrics['confusion_matrix']}")
    print(f"Saved to {OUT_DIR}")


if __name__ == "__main__":
    main()