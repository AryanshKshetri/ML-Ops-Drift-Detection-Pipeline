"""Model loading and prediction, shared by the API (main.py) and training (train.py).

The model file is reloaded automatically when train.py (or a retraining job)
replaces it, so the API never needs a restart after retraining.
"""
import json
import os
import threading
from pathlib import Path

import joblib
import pandas as pd

NUMERIC = ["tenure", "MonthlyCharges", "TotalCharges", "SeniorCitizen"]
CATEGORICAL = [
    "gender",
    "Partner",
    "Dependents",
    "PhoneService",
    "MultipleLines",
    "InternetService",
    "OnlineSecurity",
    "OnlineBackup",
    "DeviceProtection",
    "TechSupport",
    "StreamingTV",
    "StreamingMovies",
    "Contract",
    "PaperlessBilling",
    "PaymentMethod",
]
FEATURES = NUMERIC + CATEGORICAL

MODEL_DIR = Path(os.getenv("MODEL_DIR", Path(__file__).resolve().parent.parent / "saved_model"))
MODEL_PATH = MODEL_DIR / "model.joblib"
META_PATH = MODEL_DIR / "metadata.json"

_lock = threading.Lock()
_state = {"mtime": None, "model": None, "meta": None}


class ModelNotReady(Exception):
    pass


class BadInput(Exception):
    pass


def load():
    """Return (model, metadata), loading or reloading the file if it changed."""
    if not MODEL_PATH.is_file():
        raise ModelNotReady("No trained model found. Run: python -m app.train")
    mtime = MODEL_PATH.stat().st_mtime
    with _lock:
        if _state["mtime"] != mtime:
            _state["model"] = joblib.load(MODEL_PATH)
            _state["meta"] = json.loads(META_PATH.read_text()) if META_PATH.is_file() else {}
            _state["mtime"] = mtime
        return _state["model"], _state["meta"]


def predict_one(features: dict):
    model, meta = load()
    names = meta.get("features", FEATURES)
    missing = [f for f in names if f not in features]
    if missing:
        raise BadInput(f"Missing features: {missing}")

    row = pd.DataFrame([{f: features[f] for f in names}])
    for col in NUMERIC:
        try:
            row[col] = pd.to_numeric(row[col])
        except (ValueError, TypeError):
            raise BadInput(f"{col} must be a number")

    probability = float(model.predict_proba(row)[0, 1])
    return {
        "prediction": int(probability >= meta.get("threshold", 0.5)),
        "probability": round(probability, 4),
        "model_version": meta.get("model_version", "unknown"),
    }