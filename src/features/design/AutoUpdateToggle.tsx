// Interruptor de actualización automática con IA, por módulo y por sesión.
// Desactivado por defecto: al activarlo se muestra qué se enviará a Meta.
// Cuando está activo, cada guardado manual programa (agrupando) propuestas
// de actualización para los diseños desactualizados. Presentación pura:
// la programación y la ejecución viven en el workspace.
export interface AutoStatus {
  message: string;
  kind: "working" | "ok" | "error";
}

interface AutoUpdateToggleProps {
  moduleName: string;
  enabled: boolean;
  disabled: boolean;
  disabledTitle?: string;
  status: AutoStatus | null;
  onToggle: (enabled: boolean) => void;
}

export function AutoUpdateToggle({
  moduleName,
  enabled,
  disabled,
  disabledTitle,
  status,
  onToggle,
}: AutoUpdateToggleProps) {
  return (
    <div className="auto-update">
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>Actualización IA automática</span>
      </label>
      <details>
        <summary>¿Qué se envía a Meta?</summary>
        <p className="hint">
          Al guardar en {moduleName}, Ruth IDE propondrá actualizar los
          diseños que queden desactualizados. Se envían las versiones
          guardadas de los requisitos y diseños implicados (nunca borradores
          sin guardar ni otros módulos). Máximo 5 propuestas por ciclo, de
          una en una. Los resultados van a propuestas separadas en Impacto:
          nada se sobrescribe ni se acepta solo.
        </p>
      </details>
      {status !== null && (
        <p
          className={status.kind === "error" ? "error" : "hint"}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.kind === "working" ? "… " : ""}
          {status.message}
        </p>
      )}
    </div>
  );
}
