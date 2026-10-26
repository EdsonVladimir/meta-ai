import { ConnectionPanel } from "../features/connection/ConnectionPanel";

export function App() {
  return (
    <div className="page">
      <header className="brand">
        <h1>Ruth IDE</h1>
        <p>
          Espacio de trabajo visual que convierte requisitos en artefactos de
          diseño vinculados: cuando cambia una regla, detecta dependencias
          afectadas y propone ajustes para revisión humana.
        </p>
      </header>
      <main>
        <ConnectionPanel />
      </main>
      <footer>
        <p>Hito 1: base de escritorio y prueba mínima de conexión con Meta.</p>
      </footer>
    </div>
  );
}
