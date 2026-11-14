"use client";

import { useEffect } from "react";

export function AppScript() {
  useEffect(() => {
    const page = window as Window & { __cloudChaser?: boolean };
    if (page.__cloudChaser) {
      return;
    }
    page.__cloudChaser = true;
    const script = document.createElement("script");
    script.src = "/app.js";
    document.body.appendChild(script);
  }, []);
  return null;
}
