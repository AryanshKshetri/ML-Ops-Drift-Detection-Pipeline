import { Router } from "express";
import axios from "axios";
import { config } from "../config.js";
import { pool } from "../db/pool.js";

const router = Router();

const INSERT_SQL = `
  INSERT INTO predictions (features, prediction, probability, model_version)
  VALUES ($1, $2, $3, $4)
  RETURNING request_id, created_at
`;

const NUMERIC = {
  tenure: [0, 100],
  MonthlyCharges: [0, 500],
  TotalCharges: [0, 20000],
  SeniorCitizen: [0, 1],
};

const YN = ["Yes", "No"];
const YN_NOINT = ["Yes", "No", "No internet service"];
const CATEGORICAL = {
  gender: ["Male", "Female"],
  Partner: YN,
  Dependents: YN,
  PhoneService: YN,
  MultipleLines: ["Yes", "No", "No phone service"],
  InternetService: ["DSL", "Fiber optic", "No"],
  OnlineSecurity: YN_NOINT,
  OnlineBackup: YN_NOINT,
  DeviceProtection: YN_NOINT,
  TechSupport: YN_NOINT,
  StreamingTV: YN_NOINT,
  StreamingMovies: YN_NOINT,
  Contract: ["Month-to-month", "One year", "Two year"],
  PaperlessBilling: YN,
  PaymentMethod: [
    "Electronic check",
    "Mailed check",
    "Bank transfer (automatic)",
    "Credit card (automatic)",
  ],
};

function validateFeatures(features) {
  const errors = [];
  for (const [k, [min, max]] of Object.entries(NUMERIC)) {
    const v = features[k];
    if (v === undefined) errors.push(`${k} is required`);
    else if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${k} must be a number`);
    else if (v < min || v > max) errors.push(`${k} must be between ${min} and ${max}`);
  }
  for (const [k, allowed] of Object.entries(CATEGORICAL)) {
    const v = features[k];
    if (v === undefined) errors.push(`${k} is required`);
    else if (!allowed.includes(v)) errors.push(`${k} must be one of: ${allowed.join(", ")}`);
  }
  return errors;
}

router.post("/", async (req, res) => {
  const { features } = req.body;

  if (!features || typeof features !== "object" || Array.isArray(features)) {
    return res
      .status(400)
      .json({ error: "Body must contain a 'features' object" });
  }

  const errors = validateFeatures(features);
  if (errors.length) {
    return res.status(400).json({ error: "Invalid input", details: errors });
  }

  let mlResult;
  try {
    const response = await axios.post(
      `${config.mlServiceUrl}/predict`,
      { features },
      { timeout: 5000 }
    );
    mlResult = response.data;
  } catch (err) {
    // Still keep a record of the request, with empty prediction fields.
    try {
      await pool.query(INSERT_SQL, [JSON.stringify(features), null, null, null]);
    } catch (dbErr) {
      console.error("Failed to log failed request:", dbErr.message);
    }

    if (err.response) {
      return res.status(502).json({
        error: "ML service returned an error",
        details: err.response.data,
      });
    }
    return res.status(503).json({ error: "ML service unreachable or timed out" });
  }

  try {
    const { rows } = await pool.query(INSERT_SQL, [
      JSON.stringify(features),
      mlResult.prediction,
      mlResult.probability,
      mlResult.model_version,
    ]);

    res.json({
      request_id: rows[0].request_id,
      prediction: mlResult.prediction,
      probability: mlResult.probability,
      model_version: mlResult.model_version,
      created_at: rows[0].created_at,
    });
  } catch (dbErr) {
    console.error("Failed to log prediction:", dbErr.message);
    res.status(500).json({ error: "Prediction succeeded but logging failed" });
  }
});

export default router;