"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";

const SERVICE_UUID = "c64ccea3-eae9-43bf-86cd-7d5d0b7372e4";
const SENSOR_CHAR_UUID = "8d9b0b2d-1c57-4dd3-88da-8a0309152a09";
const MAX_POINTS = 30;

const TEMP_MIN = 15;
const TEMP_MAX = 30;

const PRESSURE_MIN = 0;
const PRESSURE_MAX = 200;

type SensorPoint = {
  time: string;
  tempC: number;
  pressure: number;
};

type TabKey = "main" | "settings" | "testing";

function formatNow() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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

function cardStyle(padding = "1.2rem"): React.CSSProperties {
  return {
    background: "rgba(255,255,255,0.96)",
    border: "1px solid rgba(255,255,255,0.7)",
    borderRadius: "22px",
    padding,
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
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
    background: "white",
    color: "#0f172a",
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
      : "rgba(255,255,255,0.7)",
    color: active ? "white" : "#0f172a",
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
        <div style={{ fontWeight: 800, color: "#0f172a" }}>
          {isConnected ? "Connected" : "Disconnected"}
        </div>
        <div style={{ fontSize: "0.88rem", color: "#64748b", marginTop: "0.15rem" }}>
          {deviceName}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  unit,
  accent,
  subtitle,
}: {
  title: string;
  value: string;
  unit?: string;
  accent: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        ...cardStyle("1.2rem"),
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: "6px",
          background: accent,
        }}
      />
      <div style={{ marginLeft: "0.4rem" }}>
        <div
          style={{
            fontSize: "0.82rem",
            fontWeight: 800,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.4rem",
            marginTop: "0.55rem",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: "2.15rem",
              lineHeight: 1,
              fontWeight: 800,
              color: "#0f172a",
            }}
          >
            {value}
          </div>
          {unit ? (
            <div
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: "#64748b",
              }}
            >
              {unit}
            </div>
          ) : null}
        </div>

        {subtitle ? (
          <div style={{ marginTop: "0.45rem", fontSize: "0.88rem", color: "#94a3b8" }}>
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GraphCard({
  title,
  values,
  latest,
  unit,
  minValue,
  maxValue,
  yTickStep,
  lineColor,
}: {
  title: string;
  values: number[];
  latest: string;
  unit: string;
  minValue: number;
  maxValue: number;
  yTickStep: number;
  lineColor: string;
}) {
  const width = 700;
  const height = 320;

  const margin = {
    top: 20,
    right: 24,
    bottom: 46,
    left: 62,
  };

  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const yTicks = makeTicks(minValue, maxValue, yTickStep);
  const plottedValues = values.slice(-MAX_POINTS);

  const points = useMemo(() => {
    if (plottedValues.length === 0) return "";

    return plottedValues
      .map((rawValue, index) => {
        const value = clamp(rawValue, minValue, maxValue);
        const x =
          plottedValues.length === 1
            ? margin.left + plotWidth / 2
            : margin.left + (index / (MAX_POINTS - 1)) * plotWidth;

        const y =
          margin.top +
          ((maxValue - value) / (maxValue - minValue)) * plotHeight;

        return `${x},${y}`;
      })
      .join(" ");
  }, [plottedValues, minValue, maxValue, plotWidth, plotHeight]);

  const xTicks = Array.from({ length: 6 }, (_, i) => i * 6);

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
              color: "#0f172a",
            }}
          >
            {title}
          </h3>
          <div style={{ marginTop: "0.3rem", color: "#64748b", fontSize: "0.9rem" }}>
            Fixed range: {minValue} to {maxValue} {unit}
          </div>
        </div>

        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "14px",
            padding: "0.7rem 0.9rem",
            minWidth: "130px",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700 }}>
            Current
          </div>
          <div
            style={{
              marginTop: "0.2rem",
              fontSize: "1.15rem",
              fontWeight: 800,
              color: "#0f172a",
            }}
          >
            {latest} {unit}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(180deg, #f8fbfd 0%, #eef6fb 100%)",
          border: "1px solid #dbe7ef",
          borderRadius: "20px",
          padding: "0.8rem",
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="320" role="img">
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
                  stroke="#cfe0ea"
                  strokeWidth="1"
                />
                <text
                  x={margin.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="#64748b"
                  fontWeight="600"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {xTicks.map((tick) => {
            const x = margin.left + (tick / (MAX_POINTS - 1)) * plotWidth;

            return (
              <g key={`x-${tick}`}>
                <line
                  x1={x}
                  y1={margin.top}
                  x2={x}
                  y2={margin.top + plotHeight}
                  stroke="#e2edf3"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={height - 12}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#64748b"
                  fontWeight="600"
                >
                  -{MAX_POINTS - 1 - tick}
                </text>
              </g>
            );
          })}

          <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={margin.top + plotHeight}
            stroke="#64748b"
            strokeWidth="2"
          />
          <line
            x1={margin.left}
            y1={margin.top + plotHeight}
            x2={width - margin.right}
            y2={margin.top + plotHeight}
            stroke="#64748b"
            strokeWidth="2"
          />

          <text
            x={width / 2}
            y={height - 2}
            textAnchor="middle"
            fontSize="13"
            fill="#475569"
            fontWeight="700"
          >
            Reading history (most recent at right)
          </text>

          <text
            x={18}
            y={height / 2}
            textAnchor="middle"
            fontSize="13"
            fill="#475569"
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
                    : margin.left + (index / (MAX_POINTS - 1)) * plotWidth;

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
                    stroke="white"
                    strokeWidth="2"
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

  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("Not connected");
  const [tempC, setTempC] = useState("--");
  const [pressure, setPressure] = useState("--");
  const [history, setHistory] = useState<SensorPoint[]>([]);
  const [rawBLEData, setRawBLEData] = useState("No data received yet");
  const [lastMessageTime, setLastMessageTime] = useState("--");
  const [debugNotes, setDebugNotes] = useState("");

  const [autoReconnect, setAutoReconnect] = useState(false);
  const [showTestingCards, setShowTestingCards] = useState(true);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

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

      deviceRef.current = device;
      setDeviceName(device.name || "Device");

      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService(SERVICE_UUID);
      const char = await service?.getCharacteristic(SENSOR_CHAR_UUID);

      if (!char) {
        throw new Error("Characteristic not found.");
      }

      characteristicRef.current = char;
      await char.startNotifications();

      char.addEventListener("characteristicvaluechanged", (event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const value = target.value;
        if (!value) return;

        const decoded = new TextDecoder().decode(value);
        setRawBLEData(decoded);
        setLastMessageTime(formatNow());

        try {
          const data = JSON.parse(decoded);

          const nextTemp =
            typeof data.tempC === "number" ? data.tempC : undefined;
          const nextPressure =
            typeof data.pressure === "number" ? data.pressure : undefined;

          if (nextTemp !== undefined) setTempC(nextTemp.toFixed(2));
          if (nextPressure !== undefined) setPressure(nextPressure.toFixed(2));

          setHistory((prev) => {
            const last = prev[prev.length - 1];

            const newPoint: SensorPoint = {
              time: formatNow(),
              tempC: nextTemp ?? last?.tempC ?? TEMP_MIN,
              pressure: nextPressure ?? last?.pressure ?? PRESSURE_MIN,
            };

            return [...prev, newPoint].slice(-MAX_POINTS);
          });
        } catch (error) {
          console.error("JSON parse error:", error);
        }
      });

      setIsConnected(true);
    } catch (err) {
      console.error(err);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectBLE = () => {
    deviceRef.current?.gatt?.disconnect();
    setIsConnected(false);
    setDeviceName("Disconnected");
  };

  const clearData = () => {
    setHistory([]);
    setTempC("--");
    setPressure("--");
    setRawBLEData("No data received yet");
    setLastMessageTime("--");
  };

  const tempValues = history.map((p) => p.tempC);
  const pressureValues = history.map((p) => p.pressure);

  const renderMainContent = () => {
    if (activeTab === "main") {
      return (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
              marginBottom: "1.2rem",
            }}
          >
            <MetricCard
              title="Temperature"
              value={tempC}
              unit="°C"
              accent="linear-gradient(180deg, #14b8a6 0%, #0f766e 100%)"
              subtitle={`Fixed display range ${TEMP_MIN}–${TEMP_MAX} °C`}
            />
            <MetricCard
              title="Pressure"
              value={pressure}
              unit="kPa"
              accent="linear-gradient(180deg, #60a5fa 0%, #2563eb 100%)"
              subtitle={`Fixed display range ${PRESSURE_MIN}–${PRESSURE_MAX} kPa`}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(520px, 1fr))",
              gap: "1rem",
            }}
          >
            <GraphCard
              title="Temperature Trend"
              values={tempValues}
              latest={tempC}
              unit="°C"
              minValue={TEMP_MIN}
              maxValue={TEMP_MAX}
              yTickStep={5}
              lineColor="#0f766e"
            />

            <GraphCard
              title="Pressure Trend"
              values={pressureValues}
              latest={pressure}
              unit="kPa"
              minValue={PRESSURE_MIN}
              maxValue={PRESSURE_MAX}
              yTickStep={50}
              lineColor="#2563eb"
            />
          </div>
        </>
      );
    }

    if (activeTab === "settings") {
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "1rem",
          }}
        >
          <div style={cardStyle("1.25rem")}>
            <h3 style={{ marginTop: 0 }}>Connection Settings</h3>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginTop: "1rem",
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={autoReconnect}
                onChange={(e) => setAutoReconnect(e.target.checked)}
              />
              Enable auto reconnect
            </label>

            <p style={{ color: "#64748b", marginTop: "0.8rem" }}>
              This is a placeholder UI setting for now. Later you can connect this
              to actual reconnect logic.
            </p>
          </div>

          <div style={cardStyle("1.25rem")}>
            <h3 style={{ marginTop: 0 }}>Graph Settings</h3>
            <p style={{ color: "#64748b" }}>
              Temperature range: {TEMP_MIN} to {TEMP_MAX} °C
            </p>
            <p style={{ color: "#64748b" }}>
              Pressure range: {PRESSURE_MIN} to {PRESSURE_MAX} kPa
            </p>
            <p style={{ color: "#64748b" }}>
              History window: last {MAX_POINTS} readings
            </p>
          </div>

          <div style={cardStyle("1.25rem")}>
            <h3 style={{ marginTop: 0 }}>System Info</h3>
            <p style={{ color: "#64748b" }}>
              Device name: <strong>{deviceName}</strong>
            </p>
            <p style={{ color: "#64748b" }}>
              Connection status:{" "}
              <strong>{isConnected ? "Connected" : "Disconnected"}</strong>
            </p>
          </div>
        </div>
      );
    }

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
              marginTop: "1rem",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "14px",
              padding: "1rem",
              fontFamily: "monospace",
              fontSize: "0.9rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              minHeight: "140px",
            }}
          >
            {rawBLEData}
          </div>
        </div>

        <div style={cardStyle("1.25rem")}>
          <h3 style={{ marginTop: 0 }}>Testing Details</h3>
          <p style={{ color: "#64748b" }}>
            Last message received: <strong>{lastMessageTime}</strong>
          </p>
          <p style={{ color: "#64748b" }}>
            Stored history points: <strong>{history.length}</strong>
          </p>
          <p style={{ color: "#64748b" }}>
            Characteristic active:{" "}
            <strong>{characteristicRef.current ? "Yes" : "No"}</strong>
          </p>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginTop: "1rem",
              fontWeight: 600,
            }}
          >
            <input
              type="checkbox"
              checked={showTestingCards}
              onChange={(e) => setShowTestingCards(e.target.checked)}
            />
            Show extra testing cards
          </label>
        </div>

        <div style={cardStyle("1.25rem")}>
          <h3 style={{ marginTop: 0 }}>Developer Notes</h3>
          <textarea
            value={debugNotes}
            onChange={(e) => setDebugNotes(e.target.value)}
            placeholder="Write quick notes while testing..."
            style={{
              width: "100%",
              minHeight: "160px",
              borderRadius: "14px",
              border: "1px solid #dbe7ef",
              padding: "0.9rem",
              fontSize: "0.95rem",
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>

        {showTestingCards && (
          <div style={cardStyle("1.25rem")}>
            <h3 style={{ marginTop: 0 }}>Live Snapshot</h3>
            <p style={{ color: "#64748b" }}>
              Temperature now: <strong>{tempC} °C</strong>
            </p>
            <p style={{ color: "#64748b" }}>
              Pressure now: <strong>{pressure} kPa</strong>
            </p>
            <p style={{ color: "#64748b" }}>
              Connected device: <strong>{deviceName}</strong>
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, #dbeafe 0%, #e0f2fe 22%, #f0fdfa 45%, #f8fafc 72%, #eef2ff 100%)",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: "#0f172a",
      }}
    >
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.25)",
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
              background: "rgba(255,255,255,0.86)",
              backdropFilter: "blur(14px)",
              borderRight: "1px solid rgba(203,213,225,0.8)",
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
                  src="/flo2_logo.png"
                  alt="FLO2 Logo"
                  width={48}
                  height={48}
                  style={{ objectFit: "contain" }}
                />
                <div>
                  <div style={{ fontWeight: 800, fontSize: "1rem" }}>FLO2</div>
                  <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
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
                  color: "#475569",
                }}
              >
                ×
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
                    ☰
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
                      FLO2 Monitoring System
                    </h1>
                    <div style={{ fontSize: "1rem", opacity: 0.92 }}>
                      {activeTab === "main" && "Live temperature and pressure overview"}
                      {activeTab === "settings" && "System settings and preferences"}
                      {activeTab === "testing" && "Development and diagnostic tools"}
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
                      background: "white",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "18px",
                      padding: "0.7rem",
                    }}
                  >
                    <Image
                      src="/flo2_logo.png"
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

              <button onClick={clearData} style={buttonStyle("secondary")}>
                Clear Data
              </button>
            </div>

            {renderMainContent()}
          </div>
        </div>
      </div>
    </main>
  );
}