import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Drift from "./pages/Drift.jsx";
import Performance from "./pages/Performance.jsx";
import Retraining from "./pages/Retraining.jsx";
import Models from "./pages/Models.jsx";
import ComingSoon from "./pages/ComingSoon.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Drift />} />
        <Route path="performance" element={<Performance />} />
        <Route path="retraining" element={<Retraining />} />
        <Route path="models" element={<Models />} />
        <Route path="*" element={<ComingSoon title="Not found" feeds={[]} />} />
      </Route>
    </Routes>
  );
}
