
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const SERVICE_UUID = "c64ccea3-eae9-43bf-86cd-7d5d0b7372e4";
const SENSOR_CHAR_UUID = "8d9b0b2d-1c57-4b8c-9a72-4d6c5d8e9011";
const MAX_POINTS = 30;

type SensorPoint = {
  time: string;
  tempC: number;
};

function formatNow() {
  return new Date().toLocaleTimeString();
}

function buildPolylinePoints(values: number[], width = 320, height = 120) {
  if (values.length === 0) return "";

 // graph setup 
  const MIN_TEMP = 15;
  const MAX_TEMP = 30;
  const range = MAX_TEMP - MIN_TEMP;

  return values
    .map((value, index) => {
      const x =
        values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;

      const clamped = Math.max(MIN_TEMP, Math.min(MAX_TEMP, value));

      const y = height - ((clamped - MIN_TEMP) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function StatCard({
  title,
  value,
  unit,
}: {
  title: string;
  value: string;
  unit?: string;
}) {
  return (
    <div
      style={{
        backgroundColor: "white",
        borderRadius: "16px",
        padding: "1.25rem",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.95rem", color: "#666" }}>{title}</p>
      <h2 style={{ margin: "0.5rem 0 0 0", fontSize: "2rem" }}>
        {value}
        {unit ? (
          <span style={{ fontSize: "1rem", color: "#666", marginLeft: "0.35rem" }}>
            {unit}
          </span>
        ) : null}
      </h2>
    </div>
  );
}

function LineChartCard({
  title,
  values,
  unit,
}: {
  title: string;
  values: number[];
  unit: string;
}) {
  const polylinePoints = useMemo(() => buildPolylinePoints(values), [values]);
  const latest = values.length ? values[values.length - 1].toFixed(2) : "--";
  const min = values.length ? Math.min(...values).toFixed(2) : "--";
  const max = values.length ? Math.max(...values).toFixed(2) : "--";

  return (
    <div
      style={{
        backgroundColor: "white",
        borderRadius: "16px",
        padding: "1.25rem",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "0.75rem",
          gap: "1rem",
        }}
      >
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span style={{ color: "#666", fontSize: "0.95rem" }}>
          Latest: {latest} {unit}
        </span>
      </div>

      <div
        style={{
          backgroundColor: "#f7f7f7",
          borderRadius: "12px",
          padding: "0.75rem",
        }}
      >

        <svg viewBox="0 0 320 120" width="100%" height="140" role="img">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            points={polylinePoints}
          />
        </svg>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "0.75rem",
          fontSize: "0.9rem",
          color: "#666",
        }}
      >
        <span>Min: {min}</span>
        <span>Max: {max}</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("Not connected");
  const [tempC, setTempC] = useState("--");
  const [rawData, setRawData] = useState("No data received yet");
  const [errorMessage, setErrorMessage] = useState("");
  const [history, setHistory] = useState<SensorPoint[]>([]);
  const [autoReconnect, setAutoReconnect] = useState(false);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const handlerRef = useRef<((event: Event) => void) | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetDisplayValues = () => {
    setTempC("--");
    setRawData("No data received yet");
  };

  const clearData = () => {
    setHistory([]);
    resetDisplayValues();
    setErrorMessage("");
  };

  const clearReconnectTimer = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const cleanupNotifications = async () => {
    const characteristic = characteristicRef.current;
    const handler = handlerRef.current;

    if (characteristic && handler) {
      try {
        characteristic.removeEventListener("characteristicvaluechanged", handler);
      } catch {}

      try {
        await characteristic.stopNotifications();
      } catch {}
    }

    characteristicRef.current = null;
    handlerRef.current = null;
  };

  const disconnectBLE = async (manual = true) => {
    try {
      clearReconnectTimer();
      await cleanupNotifications();

      const device = deviceRef.current;
      if (device?.gatt?.connected) {
        device.gatt.disconnect();
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (manual) {
        deviceRef.current = null;
      }
      setIsConnected(false);
      setIsConnecting(false);
      setDeviceName(manual ? "Disconnected" : "Connection lost");
    }
  };

  const subscribeToCharacteristic = async (
    characteristic: BluetoothRemoteGATTCharacteristic
  ) => {
    await cleanupNotifications();
    await characteristic.startNotifications();

    const handleCharacteristicValueChanged = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const value = target.value;
      if (!value) return;

      const decoded = new TextDecoder().decode(value);
      setRawData(decoded);

      try {
        const parsed = JSON.parse(decoded);

        if (typeof parsed.tempC === "number") {
          setTempC(parsed.tempC.toFixed(2));

          setHistory((prev) => {
            const next = [
              ...prev,
              {
                time: formatNow(),
                tempC: parsed.tempC,
              },
            ];
            return next.slice(-MAX_POINTS);
          });
        }
      } catch (jsonError) {
        console.error("JSON parse error:", jsonError);
      }
    };

    characteristic.addEventListener(
      "characteristicvaluechanged",
      handleCharacteristicValueChanged
    );

    characteristicRef.current = characteristic;
    handlerRef.current = handleCharacteristicValueChanged;
  };

  const reconnectToKnownDevice = async () => {
    const device = deviceRef.current;
    if (!device) return;

    try {
      setIsConnecting(true);
      setErrorMessage("");

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error("Failed to reconnect to GATT server.");
      }

      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(SENSOR_CHAR_UUID);

      await subscribeToCharacteristic(characteristic);

      setIsConnected(true);
      setDeviceName(device.name || "Unnamed BLE Device");
    } catch (error) {
      console.error("Reconnect failed:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Reconnect attempt failed."
      );

      if (autoReconnect) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectToKnownDevice();
        }, 2000);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const connectBLE = async () => {
    setIsConnecting(true);
    setErrorMessage("");

    try {
      if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth is not supported in this browser.");
      }

      if (deviceRef.current?.gatt?.connected) {
        await disconnectBLE();
      }

      clearReconnectTimer();

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });

      deviceRef.current = device;
      setDeviceName(device.name || "Unnamed BLE Device");
      setHistory([]);
      resetDisplayValues();

      device.addEventListener("gattserverdisconnected", async () => {
        await cleanupNotifications();
        setIsConnected(false);
        setDeviceName("Connection lost");

        if (autoReconnect && deviceRef.current) {
          clearReconnectTimer();
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectToKnownDevice();
          }, 2000);
        }
      });

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error("Failed to connect to GATT server.");
      }

      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(SENSOR_CHAR_UUID);

      await subscribeToCharacteristic(characteristic);

      setIsConnected(true);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown connection error."
      );
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    return () => {
      clearReconnectTimer();
    };
  }, []);

  const latestTimestamp =
    history.length > 0 ? history[history.length - 1].time : "--";

  const tempValues = history.map((point) => point.tempC);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "2rem",
        fontFamily: "Arial, sans-serif",
        backgroundColor: "#f4f6f8",
        color: "#111",
      }}
    >
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>DASHBOARD TITLE</h1>
            <p style={{ margin: "0.5rem 0 0 0", color: "#666" }}> 
              Caption Here
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              onClick={connectBLE}
              disabled={isConnecting || isConnected}
              style={{
                padding: "0.95rem 1.25rem",
                fontSize: "1rem",
                borderRadius: "12px",
                border: "none",
                cursor:
                  isConnecting || isConnected ? "not-allowed" : "pointer",
                opacity: isConnecting || isConnected ? 0.7 : 1,
                backgroundColor: "white",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              }}
            >
              {isConnecting ? "Connecting..." : "Connect Device"}
            </button>
          
            <button
              onClick={() => disconnectBLE()}
              disabled={!isConnected}
              style={{
                padding: "0.95rem 1.25rem",
                fontSize: "1rem",
                borderRadius: "12px",
                border: "none",
                cursor: !isConnected ? "not-allowed" : "pointer",
                opacity: !isConnected ? 0.7 : 1,
                backgroundColor: "pink",
                boxShadow: "0 4px 16px rgba(234, 164, 237, 0.08)",
              }}
            >
              Disconnect
            </button>

            <button
              onClick={clearData}
              style={{
                padding: "0.95rem 1.25rem",
                fontSize: "1rem",
                borderRadius: "12px",
                border: "none",
                cursor: "pointer",
                backgroundColor: "white",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              }}
            >
              Clear Data
            </button>
          </div>
        </div>

        <div
          style={{
            marginBottom: "1rem",
            backgroundColor: "white",
            borderRadius: "16px",
            padding: "1rem 1.25rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={autoReconnect}
              onChange={(e) => setAutoReconnect(e.target.checked)}
            />
            Auto reconnect after disconnect
          </label>

          <span style={{ color: "#666" }}>
            {autoReconnect
              ? "Enabled: the app will try reconnecting every 2 seconds."
              : "Disabled"}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <StatCard
            title="Connection Status"
            value={isConnected ? "Connected" : "Not Connected"}
          />
          <StatCard title="Device Name" value={deviceName} />
          <StatCard title="Temperature" value={tempC} unit="°C" />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <LineChartCard title="Temperature Trend" values={tempValues} unit="°C" />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: "1rem",
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "16px",
              padding: "1.25rem",
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              overflowX: "auto",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Recent Readings</h3>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.95rem",
              }}
            >
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={{ padding: "0.6rem 0" }}>Time</th>
                  <th style={{ padding: "0.6rem 0" }}>Temp (°C)</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((point, index) => (
                  <tr
                    key={`${point.time}-${index}`}
                    style={{ borderBottom: "1px solid #eee" }}
                  >
                    <td style={{ padding: "0.55rem 0" }}>{point.time}</td>
                    <td style={{ padding: "0.55rem 0" }}>
                      {point.tempC.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              backgroundColor: "white",
              borderRadius: "16px",
              padding: "1.25rem",
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Debug Panel</h3>
            <p>
              <strong>Last Update:</strong> {latestTimestamp}
            </p>
            <p>
              <strong>Raw BLE Data:</strong>
            </p>
            <pre
              style={{
                backgroundColor: "#f7f7f7",
                padding: "0.9rem",
                borderRadius: "12px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                minHeight: "100px",
              }}
            >
              {rawData}
            </pre>

            {errorMessage && (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "1rem",
                  backgroundColor: "#ffe5e5",
                  borderRadius: "12px",
                  color: "#900",
                }}
              >
                <strong>Error:</strong> {errorMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}