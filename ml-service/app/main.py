"""Churn model service (FastAPI).

POST /predict    {"features": {...19 Telco fields...}}
                 -> {"prediction": 0|1, "probability": 0.0-1.0, "model_version": "v1"}
GET  /health     is a model loaded?
GET  /model-info metadata written by train.py (version, metrics, features)
"""
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app import model

app = FastAPI(title="Churn model service")


class PredictRequest(BaseModel):
    features: dict[str, Any]


@app.get("/health")
def health():
    try:
        _, meta = model.load()
    except model.ModelNotReady as e:
        return {"status": "no_model", "detail": str(e)}
    return {"status": "ok", "model_version": meta.get("model_version")}


@app.get("/model-info")
def model_info():
    try:
        _, meta = model.load()
    except model.ModelNotReady as e:
        raise HTTPException(status_code=503, detail=str(e))
    return meta


@app.post("/predict")
def predict(req: PredictRequest):
    try:
        return model.predict_one(req.features)
    except model.ModelNotReady as e:
        raise HTTPException(status_code=503, detail=str(e))
    except model.BadInput as e:
        raise HTTPException(status_code=422, detail=str(e))