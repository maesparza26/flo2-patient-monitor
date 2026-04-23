"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

const SERVICE_UUID = "c64ccea3-eae9-43bf-86cd-7d5d0b7372e4";
const SENSOR_CHAR_UUID = "8d9b0b2d-1c57-4b8c-9a72-4d6c5d8e9011";
const MAX_POINTS = 100;
const PROJECT_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const TEMP_MIN = 75;
const TEMP_MAX = 85;
const MIN_SECONDS_BETWEEN_PRESSES = 4;
const PRESS_INTERVAL_GRACE_SECONDS = 0.2;
const PRESS_SIGNAL_THRESHOLD = 0;

const PRESSURE_MIN = -5;
const PRESSURE_MAX = 25;
const PRESSURE_FALLBACK = 0;
const PRESSURE_UNIT = "cm H2O";

const VOLUME_MIN = 0;
const VOLUME_MAX = 700;
const VOLUME_FALLBACK = 0;

type SensorPoint = {
  time: string;
  tempF: number;
  pressure: number;
  tidal_volume: number;
  peak_tidal_volume?: number;
};

type LoggedReading = {
  time: string;
  tempF: number;
  pressureCmH2O?: number;
  tidal_volume: number;
  peakTidalVolumeML?: number;
};

type TabKey = "main" | "settings" | "testing" | "patientlogs";
type ThemeMode = "light" | "dark";

type RangeState = {
  min: number;
  max: number;
};

type LoggedSession = {
  logId: string;
  patientId: string;
  startedAt: string;
  endedAt?: string;
  patientName: string;
  dob: string;
  weight: string;
  note: string;
  entries: LoggedReading[];
};

type RawBLEMetrics = {
  tempF?: number;
  pressureCmH2O?: number;
  tidalVolumeML?: number;
  peakTidalVolumeML?: number;
};

type PatientLogExportOutcome = {
  label: string;
  detail: string;
};

function formatNow() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatChartTimeLabel(value: string, isLatest: boolean) {
  if (isLatest) return "Now";
  return value;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function makeTicks(min: number, max: number, step: number) {
  const ticks: number[] = [];
  for (let value = min; value <= max; value += step) {
    ticks.push(value);
  }
  return ticks;
}

function formatAxisNumber(value: number, showPositiveSign: boolean) {
  if (showPositiveSign && value > 0) return `+${value}`;
  return value.toString();
}

function normalizeRange(range: RangeState, fallbackStep = 1) {
  if (range.max <= range.min) {
    return {
      min: range.min,
      max: range.min + fallbackStep,
    };
  }

  return range;
}

function readNumericMetric(
  source: unknown,
  keys: string[]
): number | undefined {
  if (!source || typeof source !== "object") return undefined;

  const record = source as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return undefined;
}

const LOG_STORAGE_KEY = "flo2_logged_sessions";
const THEME_STORAGE_KEY = "flo2_theme_mode";
const DEMO_AUTH_STORAGE_KEY = "flo2_demo_auth_session";
const DEMO_AUTH_USERNAME = "clinician";
const DEMO_AUTH_PASSWORD = "flo2-demo";

type DemoAuthSession = {
  username: string;
  signedInAt: number;
};

function getAssetPath(path: string) {
  return `${PROJECT_BASE_PATH}${path}`;
}

function formatLogId(date = new Date()) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatPatientId(value: number) {
  return `PT-${value.toString().padStart(3, "0")}`;
}

function getNextPatientId(sessions: LoggedSession[]) {
  const maxId = sessions.reduce((maxValue, entry) => {
    const match = entry.patientId.match(/^PT-(\d+)$/i);
    if (!match) return maxValue;
    return Math.max(maxValue, Number(match[1]));
  }, 0);

  return formatPatientId(maxId + 1);
}

function parseLogTimestamp(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

function formatLogTimestamp(value: string) {
  const parsed = parseLogTimestamp(value);
  if (!parsed) return value;

  return parsed.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLoggingDuration(startedAt: string, endedAt?: string) {
  const start = parseLogTimestamp(startedAt);
  const end = endedAt ? parseLogTimestamp(endedAt) : null;

  if (!start) return "Unavailable";
  if (!end) return "In progress";

  const totalSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function parseWeightToKg(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const parsed = Number.parseFloat(normalized.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  if (normalized.includes("lb")) {
    return parsed / 2.20462;
  }

  return parsed;
}

function sanitizeFilename(value: string) {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim();
  return cleaned || "patient-log";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

function worksheetCell(value: string | number, rowIndex: number, columnIndex: number) {
  const cellRef = `${columnName(columnIndex)}${rowIndex + 1}`;

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${cellRef}"><v>${value}</v></c>`;
  }

  return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
}

function worksheetXml(rows: Array<Array<string | number>>) {
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((cell, columnIndex) => worksheetCell(cell, rowIndex, columnIndex))
          .join("")}</row>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
}

function createCrc32Table() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    return value >>> 0;
  });
}

const CRC32_TABLE = createCrc32Table();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  bytes.forEach((byte) => {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });

  return (crc ^ 0xffffffff) >>> 0;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

function zipDateParts(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { dosTime, dosDate };
}

function createZip(files: Array<{ path: string; content: string }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const { dosTime, dosDate } = zipDateParts();
  let localOffset = 0;

  files.forEach((file) => {
    const nameBytes = textBytes(file.path);
    const contentBytes = textBytes(file.content);
    const checksum = crc32(contentBytes);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, contentBytes.length, true);
    localView.setUint32(22, contentBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);

    localParts.push(localHeader, nameBytes, contentBytes);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, contentBytes.length, true);
    centralView.setUint32(24, contentBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);

    centralParts.push(centralHeader, nameBytes);
    localOffset += localHeader.length + nameBytes.length + contentBytes.length;
  });

  const centralDirectory = concatBytes(centralParts);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return concatBytes([...localParts, centralDirectory, endRecord]);
}

function createPatientLogWorkbook(
  log: LoggedSession,
  outcome: PatientLogExportOutcome | null
) {
  const summaryRows: Array<Array<string | number>> = [
    ["Patient ID", log.patientId],
    ["Patient Name", log.patientName || "Not recorded"],
    ["Date of Birth", log.dob || "Not recorded"],
    ["Weight", log.weight || "Not recorded"],
    ["Logging Started", formatLogTimestamp(log.startedAt)],
    ["Logging Ended", log.endedAt ? formatLogTimestamp(log.endedAt) : "In progress"],
    ["Logging Length", formatLoggingDuration(log.startedAt, log.endedAt)],
    ["Outcome", outcome?.label ?? "Unavailable"],
    ["Outcome Detail", outcome?.detail ?? "No outcome available"],
    ["Clinician Note", log.note || ""],
    ["Reading Count", log.entries.length],
  ];

  const readingRows: Array<Array<string | number>> = [
    [
      "Reading Number",
      "Time",
      "Temperature (F)",
      "Pressure (cm H2O)",
      "Tidal Volume (mL)",
      "Peak Tidal Volume (mL)",
    ],
    ...log.entries.map((entry, index) => [
      index + 1,
      entry.time,
      Number(entry.tempF.toFixed(2)),
      entry.pressureCmH2O !== undefined
        ? Number(entry.pressureCmH2O.toFixed(2))
        : "Not recorded",
      Number(entry.tidal_volume.toFixed(0)),
      entry.peakTidalVolumeML !== undefined
        ? Number(entry.peakTidalVolumeML.toFixed(0))
        : "Not recorded",
    ]),
  ];

  return createZip([
    {
      path: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    {
      path: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      path: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Readings" sheetId="2" r:id="rId2"/></sheets></workbook>',
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    },
    {
      path: "xl/worksheets/sheet1.xml",
      content: worksheetXml(summaryRows),
    },
    {
      path: "xl/worksheets/sheet2.xml",
      content: worksheetXml(readingRows),
    },
  ]);
}

function downloadPatientLogWorkbook(
  log: LoggedSession,
  outcome: PatientLogExportOutcome | null
) {
  const workbook = createPatientLogWorkbook(log, outcome);
  const blob = new Blob([workbook], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  const patientName = log.patientName ? `-${log.patientName}` : "";
  link.href = url;
  link.download = `${sanitizeFilename(`${log.patientId}${patientName}-${log.startedAt}`)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function getPatientStatus(
  latestPoint: SensorPoint | null,
  tempMin: number,
  tempMax: number,
  tidalMinML: number,
  tidalMaxML: number,
  isStreaming: boolean,
  pressTooFastDetail: string | null
) {
  if (!latestPoint) {
    return {
      label: isStreaming ? "Waiting for data" : "No active reading",
      tone: "var(--text-muted)",
      background: "var(--surface-muted)",
      border: "#e2e8f0",
      detail: isStreaming
        ? "Streaming is on, but no readings have been received yet."
        : "Start receiving data to calculate patient status.",
    };
  }

  const issues: string[] = [];

  if (latestPoint.tempF < tempMin) {
    issues.push("Temperature Below Range");
  } else if (latestPoint.tempF > tempMax) {
    issues.push("temperature Above Range");
  }

  const tidalVolumeForStatus =
    latestPoint.peak_tidal_volume ?? latestPoint.tidal_volume;

  if (tidalVolumeForStatus < tidalMinML) {
    issues.push("Peak Tidal Volume Below Range");
  } else if (tidalVolumeForStatus > tidalMaxML) {
    issues.push("Peak Tidal Volume Above Range");
  }

  const hasFastPressIssue = Boolean(pressTooFastDetail);
  if (pressTooFastDetail) {
    issues.push(pressTooFastDetail);
  }

  if (issues.length === 0) {
    return {
      label: "Stable",
      tone: "#166534",
      background: "#f0fdf4",
      border: "#86efac",
      detail: "Temperature and peak tidal volume are both within the patient guidance ranges.",
    };
  }

  if (issues.length === 1 && !hasFastPressIssue) {
    return {
      label: "Caution",
      tone: "#9a3412",
      background: "#fff7ed",
      border: "#fdba74",
      detail: `Check patient status: ${issues[0]}.`,
    }
  }

  return {
    label: "Alert",
    tone: "#991b1b",
    background: "#fef2f2",
    border: "#fca5a5",
    detail: `Multiple Readings Are Outside Range: ${issues.join(" and ")}.`,
  };
}

function getPatientStatusVisuals(label: string, themeMode: ThemeMode) {
  if (themeMode !== "dark") {
    return {
      background: "",
      border: "",
      tone: "",
      detailText: "var(--text-subtle)",
      helperText: "var(--text-muted)",
      audioBackground: "rgba(255, 255, 255, 0.74)",
      audioBorder: "1px solid rgba(15, 23, 42, 0.08)",
      audioText: "var(--text-primary)",
      audioMutedText: "var(--text-muted)",
      audioMetricText: "var(--text-secondary)",
    };
  }

  if (label === "Stable") {
    return {
      background: "linear-gradient(135deg, rgba(20, 83, 45, 0.5), rgba(6, 78, 59, 0.34))",
      border: "#22c55e",
      tone: "#86efac",
      detailText: "#bbf7d0",
      helperText: "#a7f3d0",
      audioBackground: "rgba(6, 78, 59, 0.32)",
      audioBorder: "1px solid rgba(34, 197, 94, 0.34)",
      audioText: "#ecfdf5",
      audioMutedText: "#a7f3d0",
      audioMetricText: "#d1fae5",
    };
  }

  if (label === "Caution") {
    return {
      background: "linear-gradient(135deg, rgba(124, 45, 18, 0.54), rgba(120, 53, 15, 0.34))",
      border: "#fb923c",
      tone: "#fed7aa",
      detailText: "#ffedd5",
      helperText: "#fdba74",
      audioBackground: "rgba(67, 20, 7, 0.34)",
      audioBorder: "1px solid rgba(251, 146, 60, 0.38)",
      audioText: "#fff7ed",
      audioMutedText: "#fed7aa",
      audioMetricText: "#ffedd5",
    };
  }

  if (label === "Alert") {
    return {
      background: "linear-gradient(135deg, rgba(127, 29, 29, 0.58), rgba(69, 10, 10, 0.42))",
      border: "#f87171",
      tone: "#fecaca",
      detailText: "#fee2e2",
      helperText: "#fca5a5",
      audioBackground: "rgba(69, 10, 10, 0.38)",
      audioBorder: "1px solid rgba(248, 113, 113, 0.4)",
      audioText: "#fef2f2",
      audioMutedText: "#fecaca",
      audioMetricText: "#fee2e2",
    };
  }

  return {
    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.8))",
    border: "#475569",
    tone: "#cbd5e1",
    detailText: "#cbd5e1",
    helperText: "#94a3b8",
    audioBackground: "rgba(15, 23, 42, 0.5)",
    audioBorder: "1px solid rgba(148, 163, 184, 0.22)",
    audioText: "#f8fafc",
    audioMutedText: "#cbd5e1",
    audioMetricText: "#e2e8f0",
  };
}

function playPatientStatusAlert(
  audioContext: AudioContext,
  label: "Caution" | "Alert" | "Recovery"
) {
  const now = audioContext.currentTime;
  const steps =
    label === "Alert"
      ? [
          { frequency: 960, start: 0, duration: 0.68 },
        ]
      : label === "Recovery"
        ? [
            { frequency: 523.25, start: 0, duration: 0.16 },
            { frequency: 659.25, start: 0.2, duration: 0.16 },
            { frequency: 783.99, start: 0.4, duration: 0.22 },
          ]
      : [
          { frequency: 820, start: 0, duration: 0.52 },
        ];

  steps.forEach((step) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const startTime = now + step.start;
    const endTime = startTime + step.duration;

    oscillator.type =
      label === "Alert" || label === "Caution" ? "square" : "sine";
    oscillator.frequency.setValueAtTime(step.frequency, startTime);

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(
      label === "Alert" ? 0.26 : label === "Caution" ? 0.18 : 0.16,
      startTime + 0.015
    );
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(endTime);
  });
}

function getPatientStatusAlertRepeatMs(label: "Caution" | "Alert") {
  return label === "Alert" ? 900 : 1300;
}

function cardStyle(padding = "1.2rem"): React.CSSProperties {
  return {
    background: "var(--card-bg)",
    border: "1px solid var(--card-border)",
    borderRadius: "22px",
    padding,
    boxShadow: "var(--card-shadow)",
    backdropFilter: "blur(10px)",
  };
}

function buttonStyle(
  variant: "primary" | "danger" | "secondary",
  disabled = false
): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "0.9rem 1.2rem",
    borderRadius: "14px",
    border: "none",
    fontWeight: 700,
    fontSize: "0.96rem",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "0.2s ease",
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
  };

  if (variant === "primary") {
    return {
      ...base,
      background: "linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)",
      color: "white",
    };
  }

  if (variant === "danger") {
    return {
      ...base,
      background: "linear-gradient(135deg, #dc2626 0%, #f87171 100%)",
      color: "white",
    };
  }

  return {
    ...base,
    background: "var(--secondary-button-bg)",
    color: "var(--text-primary)",
    border: "1px solid var(--input-border)",
  };
}

function sidebarButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    border: "none",
    borderRadius: "16px",
    padding: "0.95rem 1rem",
    fontWeight: active ? 800 : 700,
    fontSize: "0.95rem",
    cursor: "pointer",
    background: active
      ? "linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)"
      : "var(--sidebar-button-bg)",
    color: active ? "white" : "var(--text-primary)",
    boxShadow: active ? "0 8px 20px rgba(15, 118, 110, 0.22)" : "none",
    transition: "0.2s ease",
  };
}

function StatusPill({
  isConnected,
  deviceName,
}: {
  isConnected: boolean;
  deviceName: string;
}) {
  return (
    <div
      style={{
        ...cardStyle("0.9rem 1rem"),
        minWidth: "260px",
        display: "flex",
        alignItems: "center",
        gap: "0.8rem",
      }}
    >
      <div
        style={{
          width: "14px",
          height: "14px",
          borderRadius: "999px",
          background: isConnected ? "#22c55e" : "#ef4444",
          boxShadow: isConnected
            ? "0 0 0 6px rgba(34,197,94,0.14)"
            : "0 0 0 6px rgba(239,68,68,0.14)",
          flexShrink: 0,
        }}
      />
      <div>
        <div style={{ fontWeight: 800, color: "var(--text-primary)" }}>
          {isConnected ? "Connected" : "Disconnected"}
        </div>
        <div
          style={{
            fontSize: "0.88rem",
            color: "var(--text-muted)",
            marginTop: "0.15rem",
          }}
        >
          {deviceName}
        </div>
      </div>
    </div>
  );
}

function GraphCard({
  title,
  values,
  xLabels,
  unit,
  minValue,
  maxValue,
  yTickStep,
  lineColor,
  width = 700,
  height = 320,
  maxPoints,
  summaryMode = "current",
  summaryValueOverride,
}: {
  title: string;
  values: number[];
  xLabels?: string[];
  unit: string;
  minValue: number;
  maxValue: number;
  yTickStep: number;
  lineColor: string;
  width?: number;
  height?: number;
  maxPoints?: number;
  summaryMode?: "current" | "average";
  summaryValueOverride?: string;
}) {
  const margin = {
    top: 20,
    right: 24,
    bottom: 46,
    left: 62,
  };

  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const yTicks = makeTicks(minValue, maxValue, yTickStep);
  const showSignedAxis = minValue < 0 && maxValue > 0;
  const plottedValues = maxPoints ? values.slice(-maxPoints) : values;
  const plottedXLabels =
    xLabels && xLabels.length > 0
      ? (maxPoints ? xLabels.slice(-maxPoints) : xLabels).slice(-plottedValues.length)
      : [];
  const pointCount = Math.max(plottedValues.length - 1, 1);
  const averageValue =
    plottedValues.length > 0
      ? (
          plottedValues.reduce((sum, value) => sum + value, 0) / plottedValues.length
        ).toFixed(2)
      : "--";
  const currentValue =
    plottedValues.length > 0 ? plottedValues[plottedValues.length - 1].toFixed(2) : "--";
  const summaryLabel = summaryMode === "average" ? "Average" : "Current";
  const summaryValue =
    summaryValueOverride ?? (summaryMode === "average" ? averageValue : currentValue);

  const points = useMemo(() => {
    if (plottedValues.length === 0) return "";

    return plottedValues
      .map((rawValue, index) => {
        const value = clamp(rawValue, minValue, maxValue);
        const x =
          plottedValues.length === 1
            ? margin.left + plotWidth / 2
            : margin.left + (index / pointCount) * plotWidth;

        const y =
          margin.top +
          ((maxValue - value) / (maxValue - minValue)) * plotHeight;

        return `${x},${y}`;
      })
      .join(" ");
  }, [plottedValues, minValue, maxValue, plotWidth, plotHeight, margin.left, margin.top, pointCount]);

  const tickSlots = width < 500 ? 4 : 6;
  const xTicks = Array.from(
    new Set(
      Array.from({ length: tickSlots }, (_, i) =>
        Math.round((i / Math.max(tickSlots - 1, 1)) * pointCount)
      )
    )
  );

  return (
    <div style={cardStyle("1.25rem")}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "0.9rem",
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: "1.15rem",
              fontWeight: 800,
              color: "var(--text-primary)",
            }}
          >
            {title}
          </h3>
          <div
            style={{
              marginTop: "0.3rem",
              color: "var(--text-muted)",
              fontSize: "0.9rem",
            }}
          >
            Fixed range: {formatAxisNumber(minValue, showSignedAxis)} to{" "}
            {formatAxisNumber(maxValue, showSignedAxis)} {unit}
          </div>
        </div>

        <div
          style={{
            background: "var(--surface-muted)",
            border: "1px solid var(--soft-border)",
            borderRadius: "14px",
            padding: "0.7rem 0.9rem",
            minWidth: "130px",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 700 }}>
            {summaryLabel}
          </div>
          <div
            style={{
              marginTop: "0.2rem",
              fontSize: "1.15rem",
              fontWeight: 800,
              color: "var(--text-primary)",
            }}
          >
            {summaryValue} {unit}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "var(--graph-bg)",
          border: "1px solid var(--graph-border)",
          borderRadius: "20px",
          padding: "0.8rem",
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img">
          {yTicks.map((tick) => {
            const y =
              margin.top + ((maxValue - tick) / (maxValue - minValue)) * plotHeight;

            return (
              <g key={`y-${tick}`}>
                <line
                  x1={margin.left}
                  y1={y}
                  x2={width - margin.right}
                  y2={y}
                  stroke="var(--graph-grid)"
                  strokeWidth="1"
                />
                <text
                  x={margin.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="var(--text-muted)"
                  fontWeight="600"
                >
                  {formatAxisNumber(tick, showSignedAxis)}
                </text>
              </g>
            );
          })}

          {xTicks.map((tick) => {
            const x = margin.left + (tick / pointCount) * plotWidth;
            const isLatestTick = tick === plottedValues.length - 1;
            const tickLabel = formatChartTimeLabel(
              plottedXLabels[tick] ?? "",
              isLatestTick
            );

            return (
              <g key={`x-${tick}`}>
                <line
                  x1={x}
                  y1={margin.top}
                  x2={x}
                  y2={margin.top + plotHeight}
                  stroke="var(--graph-grid)"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={height - 12}
                  textAnchor="middle"
                  fontSize="12"
                  fill="var(--text-muted)"
                  fontWeight="600"
                >
                  {tickLabel}
                </text>
              </g>
            );
          })}

          <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={margin.top + plotHeight}
            stroke="var(--graph-axis)"
            strokeWidth="2"
          />
          <line
            x1={margin.left}
            y1={margin.top + plotHeight}
            x2={width - margin.right}
            y2={margin.top + plotHeight}
            stroke="var(--graph-axis)"
            strokeWidth="2"
          />

          <text
            x={width / 2}
            y={height - 2}
            textAnchor="middle"
            fontSize="13"
            fill="var(--graph-label)"
            fontWeight="700"
          >
            Time (sec)
          </text>

          <text
            x={18}
            y={height / 2}
            textAnchor="middle"
            fontSize="13"
            fill="var(--graph-label)"
            fontWeight="700"
            transform={`rotate(-90 18 ${height / 2})`}
          >
            {title} ({unit})
          </text>

          {points && (
            <>
              <polyline
                fill="none"
                stroke={lineColor}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
              />
              {plottedValues.map((rawValue, index) => {
                const value = clamp(rawValue, minValue, maxValue);
                const x =
                  plottedValues.length === 1
                    ? margin.left + plotWidth / 2
                    : margin.left + (index / pointCount) * plotWidth;

                const y =
                  margin.top +
                  ((maxValue - value) / (maxValue - minValue)) * plotHeight;

                return (
                  <circle
                    key={`${title}-${index}`}
                    cx={x}
                    cy={y}
                    r="4"
                    fill={lineColor}
                  />
                );
              })}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("main");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");

  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [deviceName, setDeviceName] = useState("Not connected");
  const [pressure, setPressure] = useState("--");
  const [audioAlertsEnabled, setAudioAlertsEnabled] = useState(false);
  const [patientWeight, setPatientWeight] = useState("60");
  const [patientWeightUnit, setPatientWeightUnit] = useState<"kg" | "lbs">("kg");
  const [history, setHistory] = useState<SensorPoint[]>([]);
  const [rawBLEData, setRawBLEData] = useState("No data received yet");
  const [rawBLEMetrics, setRawBLEMetrics] = useState<RawBLEMetrics>({});
  const [lastMessageTime, setLastMessageTime] = useState("--");
  const [pressCount, setPressCount] = useState(0);
  const [lastPressIntervalSeconds, setLastPressIntervalSeconds] = useState<number | null>(null);
  const [pressTooFastDetail, setPressTooFastDetail] = useState<string | null>(null);
  const [zeroReadingSeconds, setZeroReadingSeconds] = useState(0);
  const [zeroReadingStartedAtMs, setZeroReadingStartedAtMs] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [patientQuery, setPatientQuery] = useState("");
  const [logSessions, setLogSessions] = useState<LoggedSession[]>([]);
  const [selectedLogId, setSelectedLogId] = useState("");
  const [activeLogId, setActiveLogId] = useState("");
  const [pendingDeleteLogId, setPendingDeleteLogId] = useState("");
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [signedInUser, setSignedInUser] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [tempRange, setTempRange] = useState<RangeState>({
    min: TEMP_MIN,
    max: TEMP_MAX,
  });
  const [pressureRange, setPressureRange] = useState<RangeState>({
    min: PRESSURE_MIN,
    max: PRESSURE_MAX,
  });
  const [volumeRange, setVolumeRange] = useState<RangeState>({
    min: VOLUME_MIN,
    max: VOLUME_MAX,
  });

  const themeVars = useMemo(
    () =>
      ({
        "--app-bg":
          themeMode === "dark"
            ? "radial-gradient(circle at top left, #0f172a 0%, #111827 28%, #111827 52%, #0b1120 76%, #020617 100%)"
            : "radial-gradient(circle at top left, #dbeafe 0%, #e0f2fe 22%, #f0fdfa 45%, #f8fafc 72%, #eef2ff 100%)",
        "--text-primary": themeMode === "dark" ? "#e5eefb" : "#0f172a",
        "--text-secondary": themeMode === "dark" ? "#cbd5e1" : "#334155",
        "--text-muted": themeMode === "dark" ? "#94a3b8" : "#64748b",
        "--text-subtle": themeMode === "dark" ? "#a8b4c7" : "#475569",
        "--card-bg": themeMode === "dark" ? "rgba(15, 23, 42, 0.84)" : "rgba(255,255,255,0.96)",
        "--card-border": themeMode === "dark" ? "rgba(148, 163, 184, 0.18)" : "rgba(255,255,255,0.7)",
        "--card-shadow":
          themeMode === "dark"
            ? "0 16px 34px rgba(2, 6, 23, 0.42)"
            : "0 10px 30px rgba(15, 23, 42, 0.08)",
        "--surface-muted": themeMode === "dark" ? "#162033" : "#f8fafc",
        "--surface-strong": themeMode === "dark" ? "#0f172a" : "#ffffff",
        "--soft-border": themeMode === "dark" ? "#334155" : "#e2e8f0",
        "--input-border": themeMode === "dark" ? "#475569" : "#cbd5e1",
        "--input-bg": themeMode === "dark" ? "#0f172a" : "#ffffff",
        "--secondary-button-bg": themeMode === "dark" ? "#162033" : "#ffffff",
        "--sidebar-bg": themeMode === "dark" ? "rgba(2, 6, 23, 0.9)" : "rgba(255,255,255,0.86)",
        "--sidebar-border": themeMode === "dark" ? "rgba(71, 85, 105, 0.58)" : "rgba(203,213,225,0.8)",
        "--sidebar-button-bg": themeMode === "dark" ? "rgba(15, 23, 42, 0.92)" : "rgba(255,255,255,0.7)",
        "--overlay-bg": themeMode === "dark" ? "rgba(2,6,23,0.58)" : "rgba(15,23,42,0.25)",
        "--graph-bg":
          themeMode === "dark"
            ? "linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(12,18,32,0.96) 100%)"
            : "linear-gradient(180deg, #f8fbfd 0%, #eef6fb 100%)",
        "--graph-border": themeMode === "dark" ? "#334155" : "#dbe7ef",
        "--graph-grid": themeMode === "dark" ? "#263244" : "#dbe7ef",
        "--graph-axis": themeMode === "dark" ? "#94a3b8" : "#64748b",
        "--graph-label": themeMode === "dark" ? "#cbd5e1" : "#475569",
      }) as React.CSSProperties,
    [themeMode]
  );

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: "12px",
    border: "1px solid var(--input-border)",
    background: "var(--input-bg)",
    color: "var(--text-primary)",
    padding: "0.8rem 0.9rem",
    fontSize: "0.95rem",
    outline: "none",
  };

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const notificationHandlerRef = useRef<((event: Event) => void) | null>(null);
  const disconnectHandlerRef = useRef<((event: Event) => void) | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAlertLoopTimeoutRef = useRef<number | null>(null);
  const lastPatientStatusRef = useRef<string>("");
  const activeLogIdRef = useRef("");
  const lastPressReleaseTimestampRef = useRef<number | null>(null);
  const pressActiveRef = useRef(false);
  const zeroReadingStartedAtRef = useRef<number | null>(null);
  const zeroReadingActiveRef = useRef(false);

  const handleBLEDeviceDisconnected = async () => {
    await stopBLEData();
    characteristicRef.current = null;
    deviceRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    setDeviceName("Disconnected");
  };

  const stopBLEData = async () => {
    const char = characteristicRef.current;
    const handler = notificationHandlerRef.current;
    const stoppedAt = formatLogId();
    const logIdToStop = activeLogIdRef.current || activeLogId;

    if (char && handler) {
      char.removeEventListener("characteristicvaluechanged", handler as EventListener);
    }

    if (char) {
      try {
        await char.stopNotifications();
      } catch (error) {
        console.error("Failed to stop notifications:", error);
      }
    }

    notificationHandlerRef.current = null;
    lastPressReleaseTimestampRef.current = null;
    pressActiveRef.current = false;
    zeroReadingStartedAtRef.current = null;
    zeroReadingActiveRef.current = false;
    setPressCount(0);
    setLastPressIntervalSeconds(null);
    setPressTooFastDetail(null);
    setZeroReadingSeconds(0);
    setZeroReadingStartedAtMs(null);
    if (logIdToStop) {
      setLogSessions((prev) =>
        prev.map((entry) =>
          entry.logId === logIdToStop
            ? {
                ...entry,
                endedAt: entry.endedAt ?? stoppedAt,
              }
            : entry
        )
      );
    }
    activeLogIdRef.current = "";
    setActiveLogId("");
    setIsStreaming(false);
  };

  const connectBLE = async () => {
    setIsConnecting(true);

    try {
      if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth is not supported in this browser.");
      }

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });

      if (deviceRef.current && disconnectHandlerRef.current) {
        deviceRef.current.removeEventListener(
          "gattserverdisconnected",
          disconnectHandlerRef.current as EventListener
        );
      }

      deviceRef.current = device;
      setDeviceName(device.name || "Device");

      const disconnectHandler = () => {
        void handleBLEDeviceDisconnected();
      };
      disconnectHandlerRef.current = disconnectHandler;
      device.addEventListener(
        "gattserverdisconnected",
        disconnectHandler as EventListener
      );

      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService(SERVICE_UUID);
      const char = await service?.getCharacteristic(SENSOR_CHAR_UUID);

      if (!char) {
        throw new Error("Characteristic not found.");
      }

      characteristicRef.current = char;
      setIsConnected(true);
    } catch (err) {
      console.error(err);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectBLE = () => {
    void stopBLEData();
    if (deviceRef.current && disconnectHandlerRef.current) {
      deviceRef.current.removeEventListener(
        "gattserverdisconnected",
        disconnectHandlerRef.current as EventListener
      );
    }
    deviceRef.current?.gatt?.disconnect();
    disconnectHandlerRef.current = null;
    deviceRef.current = null;
    setIsConnected(false);
    characteristicRef.current = null;
    setDeviceName("Disconnected");
  };

  const startBLEData = async () => {
    const char = characteristicRef.current;

    if (!char || isStreaming) {
      return;
    }

    const logId = formatLogId();
    const nextSession: LoggedSession = {
      logId,
      patientId: getNextPatientId(logSessions),
      startedAt: logId,
      patientName: "",
      dob: "",
      weight: "",
      note: "",
      entries: [],
    };

    setLogSessions((prev) => [nextSession, ...prev]);
    setSelectedLogId(logId);
    activeLogIdRef.current = logId;
    setActiveLogId(logId);
    setHistory([]);
    setRawBLEData("Waiting for data...");
    setRawBLEMetrics({});
    setLastMessageTime("--");
    lastPressReleaseTimestampRef.current = null;
    pressActiveRef.current = false;
    zeroReadingStartedAtRef.current = null;
    zeroReadingActiveRef.current = false;
    setPressCount(0);
    setLastPressIntervalSeconds(null);
    setPressTooFastDetail(null);
    setZeroReadingSeconds(0);
    setZeroReadingStartedAtMs(null);

    const handler = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const value = target.value;
      if (!value) return;

      const decoded = new TextDecoder().decode(value);
      setRawBLEData(decoded);
      setLastMessageTime(formatNow());

      try {
        const data = JSON.parse(decoded);

        const directTempF = readNumericMetric(data, [
          "tempF",
          "temperatureF",
          "temperature_f",
          "temperatureFahrenheit",
          "temperature_fahrenheit",
          "fahrenheit",
          "temp",
          "temperature",
        ]);
        const nextTempF = directTempF;
        const nextPressure = readNumericMetric(data, [
          "pressureCmH2O",
          "pressureCmH20",
          "pressure_cm_h2o",
          "pressure_cm_h20",
          "cmH2O",
          "cmH20",
          "pressure",
        ]);
        const nextTidalVolumeML = readNumericMetric(data, [
          "tidalVolumeML",
          "tidalVolumeMl",
          "tidal_volume_ml",
          "tidal_volume_mL",
          "volumeML",
          "volumeMl",
          "volume_ml",
          "volume_mL",
          "volume",
        ]);
        const nextPeakTidalVolumeML = readNumericMetric(data, [
          "peakTidalVolumeML",
          "peakTidalVolumeMl",
          "peak_tidal_volume_ml",
          "peak_tidal_volume_mL",
          "peakVolumeML",
          "peakVolumeMl",
          "peak_volume_ml",
          "peak_volume_mL",
        ]);

        setRawBLEMetrics({
          tempF: nextTempF,
          pressureCmH2O: nextPressure,
          tidalVolumeML: nextTidalVolumeML,
          peakTidalVolumeML: nextPeakTidalVolumeML,
        });

        const pressSignalValues = [
          nextPressure,
          nextTidalVolumeML,
          nextPeakTidalVolumeML,
        ].filter((value): value is number => value !== undefined);
        const isPressActive =
          pressSignalValues.length > 0 &&
          pressSignalValues.some((value) => value > PRESS_SIGNAL_THRESHOLD);
        const wasPressActive = pressActiveRef.current;
        const now = Date.now();

        if (isPressActive && !wasPressActive) {
          const previousReleaseTimestamp = lastPressReleaseTimestampRef.current;
          const nextIntervalSeconds =
            previousReleaseTimestamp !== null
              ? (now - previousReleaseTimestamp) / 1000
              : null;

          setLastPressIntervalSeconds(nextIntervalSeconds);
          setPressTooFastDetail(
            nextIntervalSeconds !== null &&
              nextIntervalSeconds < MIN_SECONDS_BETWEEN_PRESSES - PRESS_INTERVAL_GRACE_SECONDS
              ? `Pressed too fast (${nextIntervalSeconds.toFixed(1)}s after release, need ${MIN_SECONDS_BETWEEN_PRESSES}s).`
              : null
          );
        }

        if (!isPressActive && wasPressActive) {
          lastPressReleaseTimestampRef.current = now;
          setPressCount((prev) => prev + 1);
        }

        const hasTidalVolumeReading = nextTidalVolumeML !== undefined;
        const isZeroTidalVolume = hasTidalVolumeReading && nextTidalVolumeML === 0;

        if (isZeroTidalVolume) {
          if (!zeroReadingActiveRef.current) {
            zeroReadingStartedAtRef.current = now;
            zeroReadingActiveRef.current = true;
            setZeroReadingSeconds(0);
            setZeroReadingStartedAtMs(now);
          } else if (zeroReadingStartedAtRef.current !== null) {
            setZeroReadingSeconds(
              Math.max(0, Math.floor((now - zeroReadingStartedAtRef.current) / 1000))
            );
          }
        } else if (hasTidalVolumeReading) {
          zeroReadingStartedAtRef.current = null;
          zeroReadingActiveRef.current = false;
          setZeroReadingSeconds(0);
          setZeroReadingStartedAtMs(null);
        }

        pressActiveRef.current = isPressActive;

        if (nextPressure !== undefined) setPressure(nextPressure.toFixed(2));

        setHistory((prev) => {
          const last = prev[prev.length - 1];

          const newPoint: SensorPoint = {
            time: formatNow(),
            tempF: nextTempF ?? last?.tempF ?? TEMP_MIN,
            pressure: nextPressure ?? last?.pressure ?? PRESSURE_FALLBACK,
            tidal_volume: nextTidalVolumeML ?? last?.tidal_volume ?? VOLUME_FALLBACK,
            peak_tidal_volume:
              nextPeakTidalVolumeML ?? last?.peak_tidal_volume,
          };

          return [...prev, newPoint].slice(-MAX_POINTS);
        });
        setLogSessions((prev) =>
          prev.map((entry) =>
            entry.logId === logId
              ? {
                  ...entry,
                  entries: [
                    ...entry.entries,
                    {
                      time: formatNow(),
                      tempF: nextTempF ?? entry.entries[entry.entries.length - 1]?.tempF ?? TEMP_MIN,
                      pressureCmH2O:
                        nextPressure ??
                        entry.entries[entry.entries.length - 1]?.pressureCmH2O,
                      tidal_volume:
                        nextTidalVolumeML ??
                        entry.entries[entry.entries.length - 1]?.tidal_volume ??
                        VOLUME_FALLBACK,
                      peakTidalVolumeML:
                        nextPeakTidalVolumeML ??
                        entry.entries[entry.entries.length - 1]?.peakTidalVolumeML,
                    },
                  ],
                }
              : entry
          )
        );
      } catch (error) {
        console.error("JSON parse error:", error);
      }
    };

    notificationHandlerRef.current = handler;

    try {
      char.addEventListener("characteristicvaluechanged", handler as EventListener);
      await char.startNotifications();
      setIsStreaming(true);
    } catch (error) {
      console.error("Failed to start notifications:", error);
      char.removeEventListener("characteristicvaluechanged", handler as EventListener);
      notificationHandlerRef.current = null;
      setIsStreaming(false);
    }
  };

  const clearData = () => {
    setHistory([]);
    setPressure("--");
    setRawBLEData("No data received yet");
    setRawBLEMetrics({});
    setLastMessageTime("--");
    lastPressReleaseTimestampRef.current = null;
    pressActiveRef.current = false;
    zeroReadingStartedAtRef.current = null;
    zeroReadingActiveRef.current = false;
    setPressCount(0);
    setLastPressIntervalSeconds(null);
    setPressTooFastDetail(null);
    setZeroReadingSeconds(0);
    setZeroReadingStartedAtMs(null);
  };

  const tempValues = history.map((p) => p.tempF);
  const pressureValues = history.map((p) => p.pressure);
  const volumeValues = history.map((p) => p.tidal_volume);
  const historyTimes = history.map((p) => p.time);
  const latestHistoryPoint = history[history.length - 1] ?? null;
  const displayedPressureValue =
    rawBLEMetrics.pressureCmH2O ?? latestHistoryPoint?.pressure;
  const displayedPressure =
    displayedPressureValue !== undefined
      ? `${displayedPressureValue.toFixed(2)} ${PRESSURE_UNIT}`
      : pressure !== "--"
        ? `${pressure} ${PRESSURE_UNIT}`
        : "--";
  const displayedTidalVolumeValue =
    rawBLEMetrics.peakTidalVolumeML ??
    latestHistoryPoint?.peak_tidal_volume ??
    rawBLEMetrics.tidalVolumeML ??
    latestHistoryPoint?.tidal_volume;
  const displayedTidalVolume =
    displayedTidalVolumeValue !== undefined
      ? `${displayedTidalVolumeValue.toFixed(0)} mL`
      : "--";
  const displayedPeakTidalVolumeValue =
    rawBLEMetrics.peakTidalVolumeML ?? latestHistoryPoint?.peak_tidal_volume;
  const displayedPeakTidalVolume =
    displayedPeakTidalVolumeValue !== undefined
      ? `${displayedPeakTidalVolumeValue.toFixed(0)} mL`
      : "--";
  const safeTempRange = normalizeRange(tempRange);
  const safePressureRange = normalizeRange(pressureRange);
  const safeVolumeRange = normalizeRange(volumeRange);
  const parsedPatientWeight = Number(patientWeight);
  const normalizedPatientWeightKg =
    Number.isFinite(parsedPatientWeight) && parsedPatientWeight > 0
      ? patientWeightUnit === "lbs"
        ? parsedPatientWeight / 2.20462
        : parsedPatientWeight
      : null;
  const hasValidPatientWeight = normalizedPatientWeightKg !== null;
  const expectedTidalMinMl = hasValidPatientWeight ? normalizedPatientWeightKg * 6 : null;
  const expectedTidalMaxMl = hasValidPatientWeight ? normalizedPatientWeightKg * 8 : null;
  const statusTempMin = 75;
  const statusTempMax = 85;
  const statusTidalMinML = expectedTidalMinMl ?? 500;
  const statusTidalMaxML = expectedTidalMaxMl ?? 600;
  const patientStatus = getPatientStatus(
    latestHistoryPoint,
    statusTempMin,
    statusTempMax,
    statusTidalMinML,
    statusTidalMaxML,
    isStreaming,
    pressTooFastDetail
  );
  const patientStatusVisuals = getPatientStatusVisuals(
    patientStatus.label,
    themeMode
  );

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      setThemeMode(savedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    activeLogIdRef.current = activeLogId;
  }, [activeLogId]);

  useEffect(() => {
    if (!isStreaming || zeroReadingStartedAtMs === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setZeroReadingSeconds(
        Math.max(0, Math.floor((Date.now() - zeroReadingStartedAtMs) / 1000))
      );
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isStreaming, zeroReadingStartedAtMs]);

  useEffect(() => {
    if (audioAlertLoopTimeoutRef.current !== null) {
      window.clearTimeout(audioAlertLoopTimeoutRef.current);
      audioAlertLoopTimeoutRef.current = null;
    }

    if (!audioAlertsEnabled || !isStreaming) {
      lastPatientStatusRef.current = patientStatus.label;
      return;
    }

    const previousPatientStatus = lastPatientStatusRef.current;
    const statusChanged = previousPatientStatus !== patientStatus.label;
    const isRecoveryTransition =
      (previousPatientStatus === "Alert" && patientStatus.label === "Caution") ||
      (previousPatientStatus === "Caution" && patientStatus.label === "Stable");
    const shouldLoopAlert =
      patientStatus.label === "Caution" || patientStatus.label === "Alert";

    if (!shouldLoopAlert && !(isRecoveryTransition && statusChanged)) {
      lastPatientStatusRef.current = patientStatus.label;
      return;
    }

    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

    if (!AudioContextCtor) {
      lastPatientStatusRef.current = patientStatus.label;
      return;
    }

    const audioContext =
      audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = audioContext;

    const playSound = (soundLabel: "Caution" | "Alert" | "Recovery") => {
      void audioContext.resume().then(() => {
        playPatientStatusAlert(audioContext, soundLabel);
      }).catch(() => {
        // Ignore browser autoplay or device audio errors.
      });
    };

    if (shouldLoopAlert) {
      const loopLabel: "Caution" | "Alert" =
        patientStatus.label === "Alert" ? "Alert" : "Caution";

      const loopAlert = () => {
        playSound(loopLabel);
        audioAlertLoopTimeoutRef.current = window.setTimeout(
          loopAlert,
          getPatientStatusAlertRepeatMs(loopLabel)
        );
      };

      loopAlert();
    } else if (statusChanged && isRecoveryTransition) {
      playSound("Recovery");
    }

    lastPatientStatusRef.current = patientStatus.label;

    return () => {
      if (audioAlertLoopTimeoutRef.current !== null) {
        window.clearTimeout(audioAlertLoopTimeoutRef.current);
        audioAlertLoopTimeoutRef.current = null;
      }
    };
  }, [audioAlertsEnabled, isStreaming, patientStatus.label]);

  useEffect(() => {
    return () => {
      if (deviceRef.current && disconnectHandlerRef.current) {
        deviceRef.current.removeEventListener(
          "gattserverdisconnected",
          disconnectHandlerRef.current as EventListener
        );
      }
      if (audioAlertLoopTimeoutRef.current !== null) {
        window.clearTimeout(audioAlertLoopTimeoutRef.current);
        audioAlertLoopTimeoutRef.current = null;
      }
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);
  const visibleLogSessions = logSessions.filter((entry) => {
    const query = patientQuery.trim().toLowerCase();
    if (query === "") return true;

    return (
      entry.patientId.toLowerCase().includes(query) ||
      entry.logId.toLowerCase().includes(query) ||
      entry.startedAt.toLowerCase().includes(query) ||
      entry.patientName.toLowerCase().includes(query) ||
      entry.dob.toLowerCase().includes(query)
    );
  });
  const selectedLog =
    logSessions.find((entry) => entry.logId === selectedLogId) ??
    visibleLogSessions[0] ??
    null;
  const selectedLogTempValues = selectedLog?.entries.map((entry) => entry.tempF) ?? [];
  const selectedLogVolumeValues =
    selectedLog?.entries.map((entry) => entry.tidal_volume) ?? [];
  const selectedLogTimes = selectedLog?.entries.map((entry) => entry.time) ?? [];
  const selectedLogLatestEntry =
    selectedLog && selectedLog.entries.length > 0
      ? selectedLog.entries[selectedLog.entries.length - 1]
      : null;
  const selectedLogWeightKg = selectedLog ? parseWeightToKg(selectedLog.weight) : null;
  const selectedLogTidalMinML =
    selectedLogWeightKg !== null ? selectedLogWeightKg * 6 : 500;
  const selectedLogTidalMaxML =
    selectedLogWeightKg !== null ? selectedLogWeightKg * 8 : 600;
  const selectedLogOutcome = (() => {
    if (!selectedLog) {
      return null;
    }

    if (!selectedLog.endedAt) {
      return {
        label: "In Progress",
        tone: "#1d4ed8",
        background: "#eff6ff",
        border: "#93c5fd",
        detail: "Outcome is calculated after logging ends.",
      };
    }

    if (!selectedLogLatestEntry) {
      return {
        label: "No Outcome",
        tone: "var(--text-muted)",
        background: "var(--surface-muted)",
        border: "#cbd5e1",
        detail: "This log ended without a saved final reading.",
      };
    }

    const issues: string[] = [];

    if (selectedLogLatestEntry.tempF < statusTempMin || selectedLogLatestEntry.tempF > statusTempMax) {
      issues.push("temperature was out of range");
    }

    const selectedLogTidalVolumeForOutcome =
      selectedLogLatestEntry.peakTidalVolumeML ??
      selectedLogLatestEntry.tidal_volume;

    if (
      selectedLogTidalVolumeForOutcome < selectedLogTidalMinML ||
      selectedLogTidalVolumeForOutcome > selectedLogTidalMaxML
    ) {
      issues.push("peak tidal volume was out of range");
    }

    if (issues.length === 0) {
      return {
        label: "Successful",
        tone: "#166534",
        background: "#f0fdf4",
        border: "#86efac",
        detail: "The final saved temperature and peak tidal volume were within range when logging ended.",
      };
    }

    return {
      label: "Unsuccessful",
      tone: "#991b1b",
      background: "#fef2f2",
      border: "#fca5a5",
      detail: `The final saved reading was out of range when logging ended: ${issues.join(
        " and "
      )}.`,
    };
  })();
  const performSignOut = async (reason?: string) => {
    setIsAuthLoading(true);
    window.localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);

    setIsSignedIn(false);
    setSignedInUser("");
    setPassword("");
    setPatientQuery("");
    setAuthError("");
    setAuthNotice(reason || "");
    setActiveTab("settings");
    setIsAuthLoading(false);
  };

  const updateRangeValue = (
    setter: React.Dispatch<React.SetStateAction<RangeState>>,
    key: keyof RangeState,
    value: string
  ) => {
    const parsed = Number(value);
    setter((prev) => ({
      ...prev,
      [key]: Number.isNaN(parsed) ? 0 : parsed,
    }));
  };

  useEffect(() => {
    const savedLogs = window.localStorage.getItem(LOG_STORAGE_KEY);
    if (!savedLogs) {
      return;
    }

    try {
      const parsed = JSON.parse(savedLogs) as LoggedSession[];
      const normalizedLogs = parsed.map((entry, index) => ({
        ...entry,
        patientId: entry.patientId || formatPatientId(parsed.length - index),
        startedAt: entry.startedAt || entry.logId,
      }));
      setLogSessions(normalizedLogs);
      if (normalizedLogs.length > 0) {
        setSelectedLogId(normalizedLogs[0].logId);
      }
    } catch (error) {
      console.error("Unable to load saved log sessions:", error);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logSessions));
  }, [logSessions]);

  useEffect(() => {
    if (pendingDeleteLogId && pendingDeleteLogId !== selectedLogId) {
      setPendingDeleteLogId("");
    }
  }, [pendingDeleteLogId, selectedLogId]);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const rawSession = window.localStorage.getItem(DEMO_AUTH_STORAGE_KEY);
        if (!rawSession) {
          return;
        }

        const data = JSON.parse(rawSession) as DemoAuthSession;
        if (data.username) {
          setIsSignedIn(true);
          setSignedInUser(data.username.trim());
          setUsername(data.username.trim());
          setAuthNotice("");
        }
      } catch (error) {
        console.error("Session lookup failed:", error);
        window.localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
      } finally {
        setIsSessionLoading(false);
      }
    };

    loadSession();
  }, []);

  const updateSelectedLog = (updates: Partial<LoggedSession>) => {
    if (!selectedLog) {
      return;
    }

    setLogSessions((prev) =>
      prev.map((entry) =>
        entry.logId === selectedLog.logId
          ? {
              ...entry,
              ...updates,
            }
          : entry
      )
    );
  };

  const deleteSelectedLog = () => {
    if (!selectedLog) {
      return;
    }

    setLogSessions((prev) => {
      const remainingLogs = prev.filter((entry) => entry.logId !== selectedLog.logId);
      setSelectedLogId(remainingLogs[0]?.logId ?? "");
      return remainingLogs;
    });

    setPendingDeleteLogId("");
  };

  const handleSignIn = async () => {
    const normalizedUser = username.trim();
    if (!normalizedUser || !password.trim()) {
      return;
    }

    setIsAuthLoading(true);
    setAuthError("");
    setAuthNotice("");

    try {
      if (
        normalizedUser !== DEMO_AUTH_USERNAME ||
        password !== DEMO_AUTH_PASSWORD
      ) {
        setAuthError("Invalid username or password.");
        return;
      }

      const session: DemoAuthSession = {
        username: normalizedUser,
        signedInAt: Date.now(),
      };
      window.localStorage.setItem(DEMO_AUTH_STORAGE_KEY, JSON.stringify(session));

      setIsSignedIn(true);
      setSignedInUser(normalizedUser);
      setUsername(normalizedUser);
      setPassword("");
      setAuthNotice("");
      setActiveTab("patientlogs");
    } catch (error) {
      console.error("Sign in failed:", error);
      setAuthError("Unable to save the local session.");
    } finally {
      setIsAuthLoading(false);
    }
  };

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    const timeoutMs = 20 * 60 * 1000;
    let timeoutId: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        void performSignOut("Signed out after 20 minutes of inactivity.");
      }, timeoutMs);
    };

    const events: Array<keyof WindowEventMap> = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "mousemove",
    ];

    resetTimer();
    events.forEach((eventName) => {
      window.addEventListener(eventName, resetTimer, { passive: true });
    });

    return () => {
      clearTimeout(timeoutId);
      events.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimer);
      });
    };
  }, [isSignedIn]);

  const renderRangeControls = (
    title: string,
    unit: string,
    range: RangeState,
    setter: React.Dispatch<React.SetStateAction<RangeState>>
  ) => (
    <div style={cardStyle("1.25rem")}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.9rem",
          alignItems: "start",
        }}
      >
        <label
          style={{
            display: "grid",
            gap: "0.45rem",
            fontWeight: 700,
            minWidth: 0,
          }}
        >
          Min ({unit})
          <input
            type="number"
            value={range.min}
            onChange={(e) => updateRangeValue(setter, "min", e.target.value)}
            style={inputStyle}
          />
        </label>

        <label
          style={{
            display: "grid",
            gap: "0.45rem",
            fontWeight: 700,
            minWidth: 0,
          }}
        >
          Max ({unit})
          <input
            type="number"
            value={range.max}
            onChange={(e) => updateRangeValue(setter, "max", e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      <p style={{ color: "var(--text-muted)", marginBottom: 0, marginTop: "0.9rem" }}>
        Active range: {range.min} to {range.max} {unit}
      </p>
      {range.max <= range.min ? (
        <p style={{ color: "#dc2626", marginBottom: 0, marginTop: "0.5rem" }}>
          Max should be greater than min. The graph will auto-adjust until this is fixed.
        </p>
      ) : null}
    </div>
  );

  const renderMainContent = () => {
    if (activeTab === "main") {
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(520px, 1fr))",
            gap: "1rem",
          }}
        >
          <div
            style={{
              ...cardStyle("1.1rem 1.25rem"),
              gridColumn: "1 / -1",
              border: `1px solid ${
                patientStatusVisuals.border || patientStatus.border
              }`,
              background: patientStatusVisuals.background || patientStatus.background,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 320px)",
                gap: "1rem",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: "0.8rem", fontWeight: 800, color: patientStatusVisuals.helperText }}>
                  Patient Status
                </div>
                <div
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "1.3rem",
                    fontWeight: 900,
                    color: patientStatusVisuals.tone || patientStatus.tone,
                  }}
                >
                  {patientStatus.label}
                </div>
                <div style={{ marginTop: "0.35rem", color: patientStatusVisuals.detailText }}>
                  {patientStatus.detail}
                </div>
                <div style={{ marginTop: "0.35rem", color: patientStatusVisuals.helperText, fontSize: "0.92rem" }}>
                  Temperature Target: {statusTempMin}-{statusTempMax} °F
                </div>
                <div style={{ marginTop: "0.2rem", color: patientStatusVisuals.helperText, fontSize: "0.92rem" }}>
                  Tidal Volume Target: {statusTidalMinML.toFixed(0)}-
                  {statusTidalMaxML.toFixed(0)} mL
                  {hasValidPatientWeight
                    ? " from 6-8 mL/kg"
                    : " (adult fallback 500-600 mL)"}
                </div>
                <div
                  style={{
                    marginTop: "0.75rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.55rem",
                    padding: "0.55rem 0.75rem",
                    borderRadius: "14px",
                    border: patientStatusVisuals.audioBorder,
                    background: patientStatusVisuals.audioBackground,
                    color: patientStatusVisuals.audioText,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: patientStatusVisuals.audioMutedText, fontSize: "0.82rem" }}>
                    Tidal volume at zero
                  </span>
                  <span>{zeroReadingSeconds}s</span>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gap: "0.55rem",
                  minWidth: "220px",
                  color: patientStatusVisuals.audioText,
                  fontWeight: 600,
                  padding: "0.9rem 1rem",
                  borderRadius: "18px",
                  border: patientStatusVisuals.audioBorder,
                  background: patientStatusVisuals.audioBackground,
                  backdropFilter: "blur(6px)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setAudioAlertsEnabled((prev) => !prev)}
                  aria-pressed={audioAlertsEnabled}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.9rem",
                    width: "100%",
                    border: "none",
                    borderRadius: 0,
                    padding: 0,
                    background: "transparent",
                    color: patientStatusVisuals.audioText,
                    fontSize: "0.98rem",
                    fontWeight: 800,
                    cursor: "pointer",
                    transition: "0.2s ease",
                  }}
                >
                  <span style={{ textAlign: "left" }}>
                    <span style={{ display: "block" }}>Audio alerts</span>
                    <span
                      style={{
                        display: "block",
                        marginTop: "0.18rem",
                        color: patientStatusVisuals.audioMutedText,
                        fontSize: "0.82rem",
                        fontWeight: 600,
                      }}
                    >
                      {audioAlertsEnabled ? "On" : "Off"}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      position: "relative",
                      width: "58px",
                      height: "32px",
                      borderRadius: "999px",
                      background: audioAlertsEnabled
                        ? "#14b8a6"
                        : themeMode === "dark"
                          ? "#334155"
                          : "#cbd5e1",
                      transition: "0.2s ease",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: "4px",
                        left: audioAlertsEnabled ? "30px" : "4px",
                        width: "24px",
                        height: "24px",
                        borderRadius: "999px",
                        background: "var(--surface-strong)",
                        boxShadow: "0 2px 6px rgba(15, 23, 42, 0.2)",
                        transition: "0.2s ease",
                      }}
                    />
                  </span>
                </button>
                <div style={{ color: patientStatusVisuals.audioMutedText, fontSize: "0.85rem" }}>
                  Repeats while readings stay in the alert range
                </div>
              </div>
            </div>
          </div>

          <GraphCard
            title="Temperature"
            values={tempValues}
            xLabels={historyTimes}
            unit="°F"
            minValue={safeTempRange.min}
            maxValue={safeTempRange.max}
            yTickStep={5}
            lineColor="#0f766e"
            summaryMode="current"
          />

          <GraphCard
            title="Tidal Volume"
            values={volumeValues}
            xLabels={historyTimes}
            unit="mL"
            minValue={safeVolumeRange.min}
            maxValue={safeVolumeRange.max}
            yTickStep={200}
            lineColor="#2563eb"
            summaryMode="current"
            summaryValueOverride={
              displayedTidalVolumeValue !== undefined
                ? displayedTidalVolumeValue.toFixed(0)
                : "--"
            }
          />
        </div>
      );
    }

    if (activeTab === "testing") {
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: "1rem",
          }}
        >
          <div style={cardStyle("1.25rem")}>
            <h3 style={{ marginTop: 0 }}>Raw BLE Data</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "0.75rem",
                marginTop: "1rem",
              }}
            >
              <div
                style={{
                  background:
                    themeMode === "dark" ? "rgba(8, 145, 178, 0.16)" : "#ecfeff",
                  border:
                    themeMode === "dark"
                      ? "1px solid rgba(103, 232, 249, 0.22)"
                      : "1px solid #a5f3fc",
                  borderRadius: "12px",
                  padding: "0.75rem 0.85rem",
                }}
              >
                <div
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 800,
                    color: themeMode === "dark" ? "#67e8f9" : "#0f766e",
                  }}
                >
                  Temperature
                </div>
                <div style={{ marginTop: "0.25rem", fontWeight: 800, color: "var(--text-primary)" }}>
                  {rawBLEMetrics.tempF !== undefined
                    ? `${rawBLEMetrics.tempF.toFixed(2)} °F`
                    : "--"}
                </div>
              </div>
              <div
                style={{
                  background:
                    themeMode === "dark" ? "rgba(194, 65, 12, 0.16)" : "#fff7ed",
                  border:
                    themeMode === "dark"
                      ? "1px solid rgba(253, 186, 116, 0.24)"
                      : "1px solid #fdba74",
                  borderRadius: "12px",
                  padding: "0.75rem 0.85rem",
                }}
              >
                <div
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 800,
                    color: themeMode === "dark" ? "#fdba74" : "#c2410c",
                  }}
                >
                  Airway Pressure
                </div>
                <div style={{ marginTop: "0.25rem", fontWeight: 800, color: "var(--text-primary)" }}>
                  {displayedPressure}
                </div>
              </div>
              <div
                style={{
                  background:
                    themeMode === "dark" ? "rgba(37, 99, 235, 0.16)" : "#eff6ff",
                  border:
                    themeMode === "dark"
                      ? "1px solid rgba(147, 197, 253, 0.24)"
                      : "1px solid #93c5fd",
                  borderRadius: "12px",
                  padding: "0.75rem 0.85rem",
                }}
              >
                <div
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 800,
                    color: themeMode === "dark" ? "#93c5fd" : "#1d4ed8",
                  }}
                >
                  Tidal Volume
                </div>
                <div style={{ marginTop: "0.25rem", fontWeight: 800, color: "var(--text-primary)" }}>
                  {displayedTidalVolume}
                </div>
                <div style={{ marginTop: "0.2rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Device-reported from BLE payload
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: "1rem",
                background: "var(--surface-muted)",
                border: "1px solid var(--soft-border)",
                borderRadius: "14px",
                padding: "1rem",
                fontFamily: "monospace",
                fontSize: "0.9rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                minHeight: "140px",
              }}
            >
              <div
                style={{
                  marginBottom: "0.75rem",
                  fontFamily:
                    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  fontWeight: 800,
                  color: "var(--text-primary)",
                }}
              >
                Parsed airway pressure: {displayedPressure}
                <br />
                Parsed tidal volume: {displayedTidalVolume}
                <br />
                Parsed peak tidal volume: {displayedPeakTidalVolume}
              </div>
              {rawBLEData}
            </div>
          </div>

          <div style={cardStyle("1.25rem")}>
            <h3 style={{ marginTop: 0 }}>Testing Details</h3>
            <p style={{ color: "var(--text-muted)" }}>
              Last message received: <strong>{lastMessageTime}</strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Press count: <strong>{pressCount}</strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Last release-to-press interval:{" "}
              <strong>
                {lastPressIntervalSeconds !== null
                  ? `${lastPressIntervalSeconds.toFixed(1)}s`
                  : "Waiting for next press"}
              </strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Stored history points: <strong>{history.length}</strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Characteristic active:{" "}
              <strong>{characteristicRef.current ? "Yes" : "No"}</strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Data streaming: <strong>{isStreaming ? "Running" : "Stopped"}</strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Active log ID: <strong>{activeLogId || "Not logging"}</strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Airway pressure now: <strong>{displayedPressure}</strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Peak tidal volume now: <strong>{displayedPeakTidalVolume}</strong>
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Connected device: <strong>{deviceName}</strong>
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 120px",
                gap: "0.8rem",
                alignItems: "end",
                marginTop: "1rem",
              }}
            >
              <label
                style={{
                  display: "grid",
                  gap: "0.4rem",
                  fontWeight: 700,
                }}
              >
                Patient weight
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={patientWeight}
                  onChange={(e) => setPatientWeight(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    borderRadius: "12px",
                    border: "1px solid var(--input-border)",
                    padding: "0.8rem 0.9rem",
                    fontSize: "0.95rem",
                    outline: "none",
                  }}
                />
              </label>

              <label
                style={{
                  display: "grid",
                  gap: "0.4rem",
                  fontWeight: 700,
                }}
              >
                Unit
                <select
                  value={patientWeightUnit}
                  onChange={(e) =>
                    setPatientWeightUnit(e.target.value as "kg" | "lbs")
                  }
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    borderRadius: "12px",
                    border: "1px solid var(--input-border)",
                    padding: "0.8rem 0.9rem",
                    fontSize: "0.95rem",
                    outline: "none",
                    background: "var(--input-bg)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="kg">kg</option>
                  <option value="lbs">lbs</option>
                </select>
              </label>
            </div>

            <div
              style={{
                marginTop: "1rem",
                borderRadius: "14px",
                border: "1px solid var(--graph-border)",
                background: "var(--surface-muted)",
                padding: "0.9rem 1rem",
              }}
            >
              <div style={{ fontWeight: 800, color: "var(--text-primary)" }}>
                Expected Tidal Volume Range
              </div>
              {hasValidPatientWeight ? (
                <>
                  <div style={{ color: "var(--text-subtle)", marginTop: "0.35rem" }}>
                    {expectedTidalMinMl?.toFixed(0)}-{expectedTidalMaxMl?.toFixed(0)} mL
                  </div>
                  <div style={{ color: "var(--text-muted)", marginTop: "0.2rem", fontSize: "0.92rem" }}>
                    Using {normalizedPatientWeightKg?.toFixed(1)} kg at 6-8 mL/kg
                  </div>
                </>
              ) : (
                <div style={{ color: "var(--text-muted)", marginTop: "0.35rem" }}>
                  Enter a valid body weight to calculate the expected range.
                </div>
              )}
            </div>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <GraphCard
              title="Airway Pressure"
              values={pressureValues}
              xLabels={historyTimes}
              unit={PRESSURE_UNIT}
              minValue={safePressureRange.min}
              maxValue={safePressureRange.max}
              yTickStep={5}
              lineColor="#d97706"
              width={980}
              height={420}
              summaryMode="current"
            />
          </div>
        </div>
      );
    }

    if (activeTab === "patientlogs") {
      return (
        <div style={cardStyle("1.25rem")}>
          <h3 style={{ marginTop: 0, marginBottom: "0.4rem" }}>Logged Patient Data</h3>
          <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
            {isSignedIn
              ? "Each patient log uses a PT ID, with the saved start time and logging duration shown underneath."
              : "Sign in first to unlock the patient logs page."}
          </p>

          {isSignedIn ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)",
                gap: "1rem",
                alignItems: "start",
              }}
            >
              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid var(--soft-border)",
                  background: "var(--surface-strong)",
                  padding: "1rem",
                }}
              >
                <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: "0.8rem" }}>
                  Saved Log Sessions
                </div>
                <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                  Search log or patient
                  <input
                    type="text"
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    placeholder="Example: PT-001"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      borderRadius: "12px",
                      border: "1px solid var(--input-border)",
                      padding: "0.8rem 0.9rem",
                      fontSize: "0.95rem",
                      outline: "none",
                    }}
                  />
                </label>

                <div
                  style={{
                    display: "grid",
                    gap: "0.75rem",
                    marginTop: "1rem",
                    maxHeight: "560px",
                    overflowY: "auto",
                  }}
                >
                  {visibleLogSessions.length > 0 ? (
                    visibleLogSessions.map((entry) => (
                      <button
                        key={entry.logId}
                        type="button"
                        onClick={() => setSelectedLogId(entry.logId)}
                        style={{
                          textAlign: "left",
                          borderRadius: "14px",
                          border:
                            selectedLog?.logId === entry.logId
                              ? "2px solid #0f766e"
                              : `1px solid ${themeMode === "dark" ? "#334155" : "#dbe7ef"}`,
                          background:
                            selectedLog?.logId === entry.logId
                              ? themeMode === "dark"
                                ? "rgba(15, 118, 110, 0.16)"
                                : "#f0fdfa"
                              : themeMode === "dark"
                                ? "#162033"
                                : "#f8fafc",
                          padding: "0.9rem 1rem",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 800, color: "var(--text-primary)" }}>{entry.patientId}</div>
                        <div style={{ color: "var(--text-subtle)", marginTop: "0.25rem" }}>
                          {entry.patientName || "Unnamed patient"}
                        </div>
                        <div
                          style={{ color: "var(--text-muted)", marginTop: "0.25rem", fontSize: "0.92rem" }}
                        >
                          {formatLogTimestamp(entry.startedAt)}
                        </div>
                        <div
                          style={{ color: "var(--text-muted)", marginTop: "0.2rem", fontSize: "0.92rem" }}
                        >
                          Logging length: {formatLoggingDuration(entry.startedAt, entry.endedAt)}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div style={{ color: "var(--text-muted)" }}>No patient logs matched that search.</div>
                  )}
                </div>
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid var(--soft-border)",
                  background: "var(--surface-strong)",
                  padding: "1rem",
                }}
              >
                <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: "0.35rem" }}>
                  Log Details
                </div>
                <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
                  Clinicians can update patient details after the emergency response.
                </p>

                {selectedLog ? (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: "0.8rem",
                        marginTop: "1rem",
                      }}
                    >
                      <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                        Patient ID
                        <input
                          type="text"
                          value={selectedLog.patientId}
                          readOnly
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            borderRadius: "12px",
                            border: "1px solid var(--input-border)",
                            padding: "0.8rem 0.9rem",
                            fontSize: "0.95rem",
                            outline: "none",
                            background: "var(--surface-muted)",
                            color: "var(--text-subtle)",
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                        Logging started
                        <input
                          type="text"
                          value={formatLogTimestamp(selectedLog.startedAt)}
                          readOnly
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            borderRadius: "12px",
                            border: "1px solid var(--input-border)",
                            padding: "0.8rem 0.9rem",
                            fontSize: "0.95rem",
                            outline: "none",
                            background: "var(--surface-muted)",
                            color: "var(--text-subtle)",
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                        Logging length
                        <input
                          type="text"
                          value={formatLoggingDuration(selectedLog.startedAt, selectedLog.endedAt)}
                          readOnly
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            borderRadius: "12px",
                            border: "1px solid var(--input-border)",
                            padding: "0.8rem 0.9rem",
                            fontSize: "0.95rem",
                            outline: "none",
                            background: "var(--surface-muted)",
                            color: "var(--text-subtle)",
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                        Patient name
                        <input
                          type="text"
                          value={selectedLog.patientName}
                          onChange={(e) => updateSelectedLog({ patientName: e.target.value })}
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            borderRadius: "12px",
                            border: "1px solid var(--input-border)",
                            padding: "0.8rem 0.9rem",
                            fontSize: "0.95rem",
                            outline: "none",
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                        Date of birth
                        <input
                          type="text"
                          value={selectedLog.dob}
                          onChange={(e) => updateSelectedLog({ dob: e.target.value })}
                          placeholder="MM/DD/YYYY"
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            borderRadius: "12px",
                            border: "1px solid var(--input-border)",
                            padding: "0.8rem 0.9rem",
                            fontSize: "0.95rem",
                            outline: "none",
                          }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                        Weight
                        <input
                          type="text"
                          value={selectedLog.weight}
                          onChange={(e) => updateSelectedLog({ weight: e.target.value })}
                          placeholder="Example: 70 kg"
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            borderRadius: "12px",
                            border: "1px solid var(--input-border)",
                            padding: "0.8rem 0.9rem",
                            fontSize: "0.95rem",
                            outline: "none",
                          }}
                        />
                      </label>
                    </div>

                    {selectedLogOutcome ? (
                      <div
                        style={{
                          marginTop: "0.9rem",
                          borderRadius: "16px",
                          border: `1px solid ${selectedLogOutcome.border}`,
                          background: selectedLogOutcome.background,
                          padding: "0.95rem 1rem",
                        }}
                      >
                        <div
                          style={{
                            color: selectedLogOutcome.tone,
                            fontWeight: 800,
                            fontSize: "1rem",
                          }}
                        >
                          Outcome: {selectedLogOutcome.label}
                        </div>
                        <div
                          style={{
                            marginTop: "0.3rem",
                            color: selectedLogOutcome.tone,
                          }}
                        >
                          {selectedLogOutcome.detail}
                        </div>
                      </div>
                    ) : null}

                    <label
                      style={{
                        display: "grid",
                        gap: "0.4rem",
                        fontWeight: 700,
                        marginTop: "0.8rem",
                      }}
                    >
                      Clinician note
                      <textarea
                        value={selectedLog.note}
                        onChange={(e) => updateSelectedLog({ note: e.target.value })}
                        rows={4}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          borderRadius: "12px",
                          border: "1px solid var(--input-border)",
                          padding: "0.8rem 0.9rem",
                          fontSize: "0.95rem",
                          outline: "none",
                          resize: "vertical",
                        }}
                        />
                      </label>

                    <div
                      style={{
                        marginTop: "1rem",
                        borderRadius: "16px",
                        border:
                          pendingDeleteLogId === selectedLog.logId
                            ? `1px solid ${themeMode === "dark" ? "#7f1d1d" : "#fecaca"}`
                            : `1px solid ${themeMode === "dark" ? "#334155" : "#e2e8f0"}`,
                        background:
                          pendingDeleteLogId === selectedLog.logId
                            ? themeMode === "dark"
                              ? "rgba(127, 29, 29, 0.22)"
                              : "#fef2f2"
                            : themeMode === "dark"
                              ? "#162033"
                              : "#f8fafc",
                        padding: "0.9rem 1rem",
                      }}
                    >
                      {pendingDeleteLogId === selectedLog.logId ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.75rem",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div
                            style={{
                              color: themeMode === "dark" ? "#fecaca" : "#991b1b",
                              fontWeight: 700,
                            }}
                          >
                            Delete this saved log permanently?
                          </div>
                          <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteLogId("")}
                              style={buttonStyle("secondary")}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={deleteSelectedLog}
                              style={buttonStyle("danger")}
                            >
                              Confirm Delete
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.75rem",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div style={{ color: "var(--text-muted)" }}>
                            Download this session or remove it if it is no longer needed.
                          </div>
                          <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() =>
                                downloadPatientLogWorkbook(selectedLog, selectedLogOutcome)
                              }
                              style={buttonStyle("primary")}
                            >
                              Download Patient File
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteLogId(selectedLog.logId)}
                              style={buttonStyle("danger")}
                            >
                              Delete Log
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                        gap: "0.8rem",
                        marginTop: "1.2rem",
                      }}
                    >
                      <GraphCard
                        title="Saved Temperature"
                        values={selectedLogTempValues}
                        xLabels={selectedLogTimes}
                        unit="°F"
                        minValue={safeTempRange.min}
                        maxValue={safeTempRange.max}
                        yTickStep={5}
                        lineColor="#0ea5a4"
                        width={420}
                        height={220}
                        summaryMode="average"
                      />
                      <GraphCard
                        title="Saved Tidal Volume"
                        values={selectedLogVolumeValues}
                        xLabels={selectedLogTimes}
                        unit="mL"
                        minValue={safeVolumeRange.min}
                        maxValue={safeVolumeRange.max}
                        yTickStep={200}
                        lineColor="#2563eb"
                        width={420}
                        height={220}
                        summaryMode="average"
                      />
                    </div>

                    <div style={{ marginTop: "1.2rem", overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                            <th style={{ padding: "0.75rem 0.6rem" }}>Time</th>
                            <th style={{ padding: "0.75rem 0.6rem" }}>Temp</th>
                            <th style={{ padding: "0.75rem 0.6rem" }}>Pressure</th>
                            <th style={{ padding: "0.75rem 0.6rem" }}>Volume</th>
                            <th style={{ padding: "0.75rem 0.6rem" }}>Peak Volume</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedLog.entries.length > 0 ? (
                            selectedLog.entries.map((entry, index) => (
                              <tr
                                key={`${selectedLog.logId}-${entry.time}-${index}`}
                                style={{ borderBottom: "1px solid #f1f5f9" }}
                              >
                                <td style={{ padding: "0.75rem 0.6rem" }}>{entry.time}</td>
                                <td style={{ padding: "0.75rem 0.6rem" }}>
                                  {entry.tempF.toFixed(2)} °F
                                </td>
                                <td style={{ padding: "0.75rem 0.6rem" }}>
                                  {entry.pressureCmH2O !== undefined
                                    ? `${entry.pressureCmH2O.toFixed(2)} ${PRESSURE_UNIT}`
                                    : "Not recorded"}
                                </td>
                                <td style={{ padding: "0.75rem 0.6rem" }}>
                                  {entry.tidal_volume.toFixed(0)} mL
                                </td>
                                <td style={{ padding: "0.75rem 0.6rem" }}>
                                  {entry.peakTidalVolumeML !== undefined
                                    ? `${entry.peakTidalVolumeML.toFixed(0)} mL`
                                    : "Not recorded"}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={5}
                                style={{ padding: "0.9rem 0.6rem", color: "var(--text-muted)" }}
                              >
                                This log session does not have any saved readings yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div style={{ color: "var(--text-muted)" }}>
                    Start logging during a session to create a patient log.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                borderRadius: "18px",
                border: "1px dashed #cbd5e1",
                padding: "1.3rem",
                color: "var(--text-muted)",
                background: "var(--surface-muted)",
              }}
            >
              This page unlocks after a successful sign-in.
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "1rem",
        }}
      >
        {renderRangeControls("Temperature Range", "°F", tempRange, setTempRange)}
        {renderRangeControls("Pressure Range", PRESSURE_UNIT, pressureRange, setPressureRange)}
        {renderRangeControls("Volume Range", "mL", volumeRange, setVolumeRange)}

        <div style={cardStyle("1.25rem")}>
          <h3 style={{ marginTop: 0, marginBottom: "0.4rem" }}>Appearance</h3>
          <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
            Switch the monitor between the current light theme and a darker interface.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
              padding: "0.95rem 1rem",
              borderRadius: "16px",
              border: "1px solid var(--soft-border)",
              background: "var(--surface-muted)",
            }}
          >
            <div>
              <div style={{ fontWeight: 800 }}>Dark Mode</div>
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: "0.9rem",
                  marginTop: "0.2rem",
                }}
              >
                {themeMode === "dark" ? "Enabled" : "Disabled"}
              </div>
            </div>

            <button
              onClick={() =>
                setThemeMode((current) => (current === "dark" ? "light" : "dark"))
              }
              aria-pressed={themeMode === "dark"}
              aria-label="Toggle dark mode"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                padding: 0,
                background: "transparent",
                cursor: "pointer",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: "relative",
                  width: "58px",
                  height: "32px",
                  borderRadius: "999px",
                  background: themeMode === "dark" ? "#14b8a6" : "var(--input-border)",
                  transition: "0.2s ease",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "4px",
                    left: themeMode === "dark" ? "30px" : "4px",
                    width: "24px",
                    height: "24px",
                    borderRadius: "999px",
                    background: "var(--surface-strong)",
                    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.2)",
                    transition: "0.2s ease",
                  }}
                />
              </span>
            </button>
          </div>
        </div>


        <div style={cardStyle("1.25rem")}>
          <h3 style={{ marginTop: 0, marginBottom: "0.4rem" }}>Patient Log Access</h3>
          <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
            Sign in here to unlock the Patient Logs tab.
          </p>
          <p style={{ color: "#94a3b8", marginTop: 0, fontSize: "0.9rem" }}>
            Demo credentials: <strong>clinician</strong> / <strong>flo2-demo</strong>
          </p>
          {authNotice ? (
            <div
              style={{
                borderRadius: "12px",
                border: "1px solid #bfdbfe",
                background: "#eff6ff",
                color: "#1d4ed8",
                padding: "0.8rem 0.9rem",
                fontSize: "0.92rem",
                marginBottom: "0.9rem",
              }}
            >
              {authNotice}
            </div>
          ) : null}

          {isSessionLoading ? (
            <div style={{ color: "var(--text-muted)" }}>Checking session...</div>
          ) : (
            <div style={{ display: "grid", gap: "0.9rem" }}>
              <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                Username
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "grid", gap: "0.4rem", fontWeight: 700 }}>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  style={inputStyle}
                />
              </label>

              {authError ? (
                <div
                  style={{
                    borderRadius: "12px",
                    border: "1px solid #fecaca",
                    background: "#fef2f2",
                    color: "#b91c1c",
                    padding: "0.8rem 0.9rem",
                    fontSize: "0.92rem",
                  }}
                >
                  {authError}
                </div>
              ) : null}

              {isSignedIn ? (
                <div
                  style={{
                    background: "#ecfeff",
                    border: "1px solid #a5f3fc",
                    borderRadius: "14px",
                    padding: "0.9rem 1rem",
                    color: "#155e75",
                    fontWeight: 700,
                  }}
                >
                  Signed in as {signedInUser}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
                <button
                  onClick={handleSignIn}
                  disabled={!username.trim() || !password.trim() || isAuthLoading}
                  style={buttonStyle(
                    "primary",
                    !username.trim() || !password.trim() || isAuthLoading
                  )}
                >
                  {isAuthLoading ? "Signing In..." : "Sign In"}
                </button>

                <button
                  onClick={() => {
                    void performSignOut();
                  }}
                  disabled={!isSignedIn || isAuthLoading}
                  style={buttonStyle("secondary", !isSignedIn || isAuthLoading)}
                >
                  {isAuthLoading ? "Signing Out..." : "Sign Out"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={cardStyle("1.25rem")}>
          <h3 style={{ marginTop: 0 }}>Current Settings</h3>
          <p style={{ color: "var(--text-muted)" }}>
            Theme: {themeMode === "dark" ? "Dark mode" : "Light mode"}
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            Temperature range: {safeTempRange.min} to {safeTempRange.max} °F
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            Pressure range: {safePressureRange.min} to {safePressureRange.max} {PRESSURE_UNIT}
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            Volume range: {safeVolumeRange.min} to {safeVolumeRange.max} mL
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            History window: last {MAX_POINTS} readings
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            Device name: <strong>{deviceName}</strong>
          </p>
          <p style={{ color: "var(--text-muted)" }}>
            Connection status:{" "}
            <strong>{isConnected ? "Connected" : "Disconnected"}</strong>
          </p>
        </div>
      </div>
    );
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        ...themeVars,
        background: "var(--app-bg)",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: "var(--text-primary)",
        colorScheme: themeMode,
        transition: "background 0.25s ease, color 0.25s ease",
      }}
    >
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay-bg)",
            zIndex: 20,
          }}
        />
      )}

      <div style={{ display: "flex", minHeight: "100vh" }}>
        <aside
          style={{
            width: sidebarOpen ? "280px" : "0px",
            overflow: "hidden",
            transition: "width 0.25s ease",
            position: "fixed",
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 30,
          }}
        >
          <div
            style={{
              height: "100%",
              padding: "1rem",
              background: "var(--sidebar-bg)",
              backdropFilter: "blur(14px)",
              borderRight: "1px solid var(--sidebar-border)",
              boxShadow: "8px 0 24px rgba(15,23,42,0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                marginBottom: "1.2rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <Image
                  src={getAssetPath("/flo2_logo.png")}
                  alt="FLO2 Logo"
                  width={48}
                  height={48}
                  style={{ objectFit: "contain" }}
                />
                <div>
                  <div style={{ fontWeight: 800, fontSize: "1rem" }}>
                    FLO<sub>2</sub>
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    Monitoring System
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSidebarOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "1.2rem",
                  cursor: "pointer",
                  color: "var(--text-subtle)",
                }}
              >
                x
              </button>
            </div>

            <div style={{ display: "grid", gap: "0.7rem" }}>
              <button
                onClick={() => {
                  setActiveTab("main");
                  setSidebarOpen(false);
                }}
                style={sidebarButtonStyle(activeTab === "main")}
              >
                Main
              </button>

              <button
                onClick={() => {
                  setActiveTab("settings");
                  setSidebarOpen(false);
                }}
                style={sidebarButtonStyle(activeTab === "settings")}
              >
                Settings
              </button>

              <button
                onClick={() => {
                  setActiveTab("testing");
                  setSidebarOpen(false);
                }}
                style={sidebarButtonStyle(activeTab === "testing")}
              >
                Testing
              </button>

              <button
                onClick={() => {
                  if (!isSignedIn) {
                    setActiveTab("settings");
                    setSidebarOpen(false);
                    setAuthNotice("Sign in from Settings to open Patient Logs.");
                    return;
                  }

                  setActiveTab("patientlogs");
                  setSidebarOpen(false);
                }}
                disabled={!isSignedIn}
                style={{
                  ...sidebarButtonStyle(activeTab === "patientlogs"),
                  cursor: isSignedIn ? "pointer" : "not-allowed",
                  opacity: isSignedIn ? 1 : 0.55,
                }}
              >
                Patient Logs
              </button>

            </div>
          </div>
        </aside>

        <div style={{ flex: 1, width: "100%" }}>
          <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.25rem" }}>
            <div
              style={{
                ...cardStyle("1.4rem"),
                marginBottom: "1.2rem",
                background:
                  "linear-gradient(135deg, rgba(14,116,144,0.95) 0%, rgba(15,118,110,0.92) 55%, rgba(59,130,246,0.88) 100%)",
                color: "white",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: "-40px",
                  top: "-40px",
                  width: "180px",
                  height: "180px",
                  borderRadius: "999px",
                  background: "rgba(255,255,255,0.10)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: "100px",
                  bottom: "-50px",
                  width: "140px",
                  height: "140px",
                  borderRadius: "999px",
                  background: "rgba(255,255,255,0.08)",
                }}
              />

              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                  <button
                    onClick={() => setSidebarOpen(true)}
                    style={{
                      border: "1px solid rgba(255,255,255,0.28)",
                      background: "rgba(255,255,255,0.14)",
                      color: "white",
                      borderRadius: "14px",
                      width: "52px",
                      height: "52px",
                      fontSize: "1.35rem",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                    aria-label="Open sidebar"
                  >
                    =
                  </button>

                  <div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 800,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        opacity: 0.9,
                      }}
                    >
                      Dashboard
                    </div>
                    <h1
                      style={{
                        margin: "0.35rem 0 0.45rem 0",
                        fontSize: "2.2rem",
                        lineHeight: 1.1,
                      }}
                    >
                      FLO<sub>2</sub> Monitoring System
                    </h1>
                    <div style={{ fontSize: "1rem", opacity: 0.92 }}>
                      {activeTab === "main" && "Temperature and Tidal Volume Measurements"}
                      {activeTab === "settings" && "Sensor Range for Graph Controls"}
                      {activeTab === "testing" && "Pressure Diagnostics  and BLE Raw Data"}
                      {activeTab === "patientlogs" && "Patient Log Search and Record Lookup"}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  <div
                    style={{
                      background:
                        themeMode === "dark" ? "var(--card-bg)" : "white",
                      border:
                        themeMode === "dark"
                          ? "1px solid var(--card-border)"
                          : "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "18px",
                      padding: "0.7rem",
                      boxShadow:
                        themeMode === "dark"
                          ? "var(--card-shadow)"
                          : "0 8px 18px rgba(15, 23, 42, 0.08)",
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    <Image
                      src={getAssetPath("/flo2_logo.png")}
                      alt="FLO2 Logo"
                      width={78}
                      height={78}
                      style={{ objectFit: "contain" }}
                    />
                  </div>

                  <StatusPill isConnected={isConnected} deviceName={deviceName} />
                </div>
              </div>
            </div>

            {activeTab === "main" ? (
              <div
                style={{
                  display: "flex",
                  gap: "0.8rem",
                  flexWrap: "wrap",
                  marginBottom: "1.2rem",
                }}
              >
                <button
                  onClick={connectBLE}
                  disabled={isConnected || isConnecting}
                  style={buttonStyle("primary", isConnected || isConnecting)}
                >
                  {isConnecting ? "Connecting..." : "Connect Device"}
                </button>

                <button
                  onClick={disconnectBLE}
                  disabled={!isConnected}
                  style={buttonStyle("danger", !isConnected)}
                >
                  Disconnect
                </button>

                <button
                  onClick={startBLEData}
                  disabled={!isConnected || isStreaming}
                  style={buttonStyle("primary", !isConnected || isStreaming)}
                >
                  {isStreaming ? "Receiving Data..." : "Start Receiving Data"}
                </button>

                <button
                  onClick={() => {
                    void stopBLEData();
                  }}
                  disabled={!isStreaming}
                  style={buttonStyle("secondary", !isStreaming)}
                >
                  Stop Receiving Data
                </button>

                <button onClick={clearData} style={buttonStyle("secondary")}>
                  Clear Data
                </button>
              </div>
            ) : null}

            {renderMainContent()}
          </div>
        </div>
      </div>
    </main>
  );
}


