export type DatabaseCircuitMode = "closed" | "open" | "half-open";

const failureThreshold = Number(process.env.DB_CIRCUIT_FAILURE_THRESHOLD || 2);
const cooldownMs = Number(process.env.DB_CIRCUIT_COOLDOWN_MS || 60_000);

let mode: DatabaseCircuitMode = "closed";
let consecutiveFailures = 0;
let openedAt = 0;
let halfOpenProbeInFlight = false;
let lastError = "";
let lastSuccessAt = 0;
let lastFailureAt = 0;

function now() {
  return Date.now();
}

export class DatabaseCircuitOpenError extends Error {
  constructor(message = "Центральная база временно отключена защитным режимом") {
    super(message);
    this.name = "DatabaseCircuitOpenError";
  }
}

export function databaseCircuitState() {
  const remainingMs = mode === "open" ? Math.max(0, cooldownMs - (now() - openedAt)) : 0;
  return {
    mode,
    consecutiveFailures,
    failureThreshold,
    cooldownMs,
    remainingMs,
    lastError,
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : "",
    lastFailureAt: lastFailureAt ? new Date(lastFailureAt).toISOString() : "",
  };
}

export function canUseCentralDatabase() {
  if (mode === "closed") return true;
  if (mode === "half-open") return false;
  return false;
}

export function canProbeCentralDatabase() {
  if (mode === "closed") return true;
  if (mode === "half-open") return !halfOpenProbeInFlight;
  if (now() - openedAt < cooldownMs) return false;
  mode = "half-open";
  halfOpenProbeInFlight = false;
  return true;
}

export function beginCentralDatabaseProbe() {
  if (!canProbeCentralDatabase()) return false;
  if (mode === "half-open") {
    if (halfOpenProbeInFlight) return false;
    halfOpenProbeInFlight = true;
  }
  return true;
}

export function recordCentralDatabaseSuccess() {
  mode = "closed";
  consecutiveFailures = 0;
  openedAt = 0;
  halfOpenProbeInFlight = false;
  lastError = "";
  lastSuccessAt = now();
}

export function recordCentralDatabaseFailure(error: unknown) {
  consecutiveFailures += 1;
  lastFailureAt = now();
  lastError = error instanceof Error ? error.message : String(error);
  halfOpenProbeInFlight = false;

  if (mode === "half-open" || consecutiveFailures >= Math.max(1, failureThreshold)) {
    mode = "open";
    openedAt = now();
  }
}

export function assertCentralDatabaseAvailable() {
  if (!canUseCentralDatabase()) {
    const state = databaseCircuitState();
    throw new DatabaseCircuitOpenError(
      state.remainingMs > 0
        ? `Центральная база временно изолирована. Повторная проверка через ${Math.ceil(state.remainingMs / 1000)} сек.`
        : "Центральная база временно изолирована защитным режимом.",
    );
  }
}
