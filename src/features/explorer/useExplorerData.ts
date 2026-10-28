// Carga diferida del explorador: proyectos al arrancar, módulos y
// artefactos al expandir, reutilizando lo cargado. La expansión vive en
// estado local de la sesión, separada del dominio. Sin JSX.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listArtifacts } from "../design/client";
import { buildLinkIndex, type LinkIndex } from "../design/coordination";
import { getRequirement, listModules, listProjects } from "../requirements/client";
import { shouldApplyResponse, type ResponseMeta } from "../requirements/coordination";
import {
  normalizeCoreError,
  type ArtifactDto,
  type ModuleDto,
  type ProjectDto,
  type RequirementDetail,
} from "../requirements/types";
import {
  ancestorsForSelection,
  groupNodeId,
  moduleKey,
  projectNodeId,
  toggleExpanded,
} from "./explorerModel";

/** Vínculos de un módulo con sus detalles de respaldo. */
export interface ModuleGraph {
  status: "loading" | "ready" | "error";
  error: string | null;
  details: RequirementDetail[];
  index: LinkIndex | null;
}

export interface ExplorerData {
  projects: ProjectDto[];
  projectsLoading: boolean;
  projectsError: string | null;
  modulesByProject: Record<string, ModuleDto[]>;
  artifactsByModule: Record<string, ArtifactDto[]>;
  loadingKeys: string[];
  errorKeys: Record<string, string>;
  /** Vínculos por módulo (clave `proyecto/módulo`). */
  graphsByModule: Record<string, ModuleGraph>;
  expanded: string[];
  toggle: (nodeId: string) => void;
  reloadProjects: () => void;
  retryProject: (projectId: string) => void;
  retryModule: (projectId: string, moduleId: string) => void;
  retryGraph: (projectId: string, moduleId: string) => void;
}

interface UseExplorerDataArgs {
  storageReady: boolean;
  projectId: string | null;
  moduleId: string | null;
  requirementId: string | null;
  designId: string | null;
  mockupId: string | null;
  /** Al cambiar, recarga proyectos y todo lo ya cargado. */
  refreshToken: number;
}

export function useExplorerData(args: UseExplorerDataArgs): ExplorerData {
  const { storageReady, projectId, moduleId, requirementId, designId, mockupId, refreshToken } = args;
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [modulesByProject, setModulesByProject] = useState<Record<string, ModuleDto[]>>({});
  const [artifactsByModule, setArtifactsByModule] = useState<Record<string, ArtifactDto[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<string[]>([]);
  const [errorKeys, setErrorKeys] = useState<Record<string, string>>({});
  const [graphsByModule, setGraphsByModule] = useState<Record<string, ModuleGraph>>({});
  const [expanded, setExpanded] = useState<string[]>([]);

  const epochRef = useRef(0);
  const slotsRef = useRef<Record<string, ResponseMeta>>({});

  // Espejo de la caché para decidir cargas sin bucles de efectos ni
  // efectos secundarios dentro de actualizadores.
  const cacheRef = useRef({
    modulesByProject,
    artifactsByModule,
    errorKeys,
    loadingKeys,
    graphsByModule,
  });
  cacheRef.current = { modulesByProject, artifactsByModule, errorKeys, loadingKeys, graphsByModule };

  const begin = useCallback((key: string): number => {
    epochRef.current += 1;
    slotsRef.current[key] = { key, epoch: epochRef.current };
    return epochRef.current;
  }, []);

  const isFresh = useCallback((key: string, epoch: number): boolean => {
    const current = slotsRef.current[key];
    if (!current) return false;
    return shouldApplyResponse(current, { key, epoch });
  }, []);

  const setLoading = useCallback((key: string, on: boolean) => {
    setLoadingKeys((prev) =>
      on ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key),
    );
  }, []);

  const setKeyError = useCallback((key: string, message: string | null) => {
    setErrorKeys((prev) => {
      if (message === null) {
        if (!(key in prev)) return prev;
        const { [key]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: message };
    });
  }, []);

  const loadProjects = useCallback(async () => {
    const epoch = begin("projects");
    setProjectsLoading(true);
    try {
      const result = await listProjects();
      if (isFresh("projects", epoch)) {
        setProjects(result);
        setProjectsError(null);
      }
    } catch (raw) {
      if (isFresh("projects", epoch)) setProjectsError(normalizeCoreError(raw).message);
    } finally {
      if (isFresh("projects", epoch)) setProjectsLoading(false);
    }
  }, [begin, isFresh]);

  const loadModules = useCallback(
    async (pid: string) => {
      const key = projectNodeId(pid);
      const epoch = begin(key);
      setLoading(key, true);
      try {
        const result = await listModules(pid);
        if (isFresh(key, epoch)) {
          setModulesByProject((prev) => ({ ...prev, [pid]: result }));
          setKeyError(key, null);
        }
      } catch (raw) {
        if (isFresh(key, epoch)) setKeyError(key, normalizeCoreError(raw).message);
      } finally {
        if (isFresh(key, epoch)) setLoading(key, false);
      }
    },
    [begin, isFresh, setKeyError, setLoading],
  );

  const loadArtifacts = useCallback(
    async (pid: string, mid: string) => {
      const key = moduleKey(pid, mid);
      const epoch = begin(key);
      setLoading(key, true);
      try {
        const result = await listArtifacts(pid, mid);
        if (isFresh(key, epoch)) {
          setArtifactsByModule((prev) => ({ ...prev, [key]: result }));
          setKeyError(key, null);
        }
      } catch (raw) {
        if (isFresh(key, epoch)) setKeyError(key, normalizeCoreError(raw).message);
      } finally {
        if (isFresh(key, epoch)) setLoading(key, false);
      }
    },
    [begin, isFresh, setKeyError, setLoading],
  );

  /** Carga si no hay datos, no está en curso y no falló antes. */
  const ensureModules = useCallback(
    (pid: string) => {
      const cache = cacheRef.current;
      const key = projectNodeId(pid);
      if (
        cache.modulesByProject[pid] !== undefined ||
        cache.loadingKeys.includes(key) ||
        cache.errorKeys[key] !== undefined
      ) {
        return;
      }
      void loadModules(pid);
    },
    [loadModules],
  );

  const ensureArtifacts = useCallback(
    (pid: string, mid: string) => {
      const cache = cacheRef.current;
      const key = moduleKey(pid, mid);
      if (
        cache.artifactsByModule[key] !== undefined ||
        cache.loadingKeys.includes(key) ||
        cache.errorKeys[key] !== undefined
      ) {
        return;
      }
      void loadArtifacts(pid, mid);
    },
    [loadArtifacts],
  );

  /**
   * Carga los detalles del módulo y deriva el índice de vínculos desde
   * fuentes exactas. Una sola petición por artefacto, con epochs por
   * módulo para descartar respuestas tardías.
   */
  const loadGraph = useCallback(
    async (pid: string, mid: string) => {
      const key = moduleKey(pid, mid);
      const artifacts = cacheRef.current.artifactsByModule[key];
      if (artifacts === undefined) return;
      const slot = `graph:${key}`;
      const epoch = begin(slot);
      setGraphsByModule((prev) => ({
        ...prev,
        [key]: { status: "loading", error: null, details: [], index: null },
      }));
      try {
        const details = await Promise.all(artifacts.map((a) => getRequirement(a.id)));
        if (!isFresh(slot, epoch)) return;
        setGraphsByModule((prev) => ({
          ...prev,
          [key]: { status: "ready", error: null, details, index: buildLinkIndex(details) },
        }));
      } catch (raw) {
        if (!isFresh(slot, epoch)) return;
        setGraphsByModule((prev) => ({
          ...prev,
          [key]: {
            status: "error",
            error: normalizeCoreError(raw).message,
            details: [],
            index: null,
          },
        }));
      }
    },
    [begin, isFresh],
  );

  /** Asegura vínculos si hay artefactos y no hay carga en curso ni datos. */
  const ensureGraph = useCallback(
    (pid: string, mid: string) => {
      const key = moduleKey(pid, mid);
      const cache = cacheRef.current;
      if (cache.artifactsByModule[key] === undefined) return;
      const graph = cache.graphsByModule[key];
      if (graph !== undefined && graph.status !== "error") return;
      void loadGraph(pid, mid);
    },
    [loadGraph],
  );

  // Módulos cuyos vínculos interesan: el seleccionado y cualquiera con
  // un requisito expandido. Los artefactos pueden llegar después de
  // pedirlos, así que un efecto reintenta al completarse cada lista.
  const wantedGraphsRef = useRef<Set<string>>(new Set());

  const wantGraph = useCallback(
    (pid: string, mid: string) => {
      wantedGraphsRef.current.add(moduleKey(pid, mid));
      ensureGraph(pid, mid);
    },
    [ensureGraph],
  );

  // Al llegar (o renovarse) la lista de un módulo querido, el grafo se
  // carga o se rederiva. Así el refresh explícito también lo actualiza,
  // siempre sobre la lista nueva y nunca sobre la anterior.
  const prevArtifactsRef = useRef(artifactsByModule);
  useEffect(() => {
    const prev = prevArtifactsRef.current;
    prevArtifactsRef.current = artifactsByModule;
    for (const key of wantedGraphsRef.current) {
      const list = artifactsByModule[key];
      if (list === undefined || list === prev[key]) continue;
      const sep = key.indexOf("/");
      if (cacheRef.current.graphsByModule[key]?.status === "ready") {
        void loadGraph(key.slice(0, sep), key.slice(sep + 1));
      } else {
        ensureGraph(key.slice(0, sep), key.slice(sep + 1));
      }
    }
  }, [artifactsByModule, ensureGraph, loadGraph]);

  // Proyectos al estar listo; ante refresh explícito se recarga además
  // todo lo ya cargado (creaciones y aceptaciones), sin tocar lo nunca
  // abierto. Los grafos se rederivan al renovarse sus listas.
  useEffect(() => {
    if (!storageReady) return;
    void loadProjects();
    const cache = cacheRef.current;
    for (const pid of Object.keys(cache.modulesByProject)) void loadModules(pid);
    for (const key of Object.keys(cache.artifactsByModule)) {
      const sep = key.indexOf("/");
      void loadArtifacts(key.slice(0, sep), key.slice(sep + 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady, refreshToken]);

  // La selección expande a sus ancestros y asegura sus datos. No incluye
  // moduleNodeId en el toggle: expandir un módulo abre también sus grupos.
  useEffect(() => {
    if (projectId === null) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ancestorsForSelection(projectId, moduleId, requirementId, designId, mockupId)) {
        next.add(id);
      }
      return [...next];
    });
    ensureModules(projectId);
    if (moduleId !== null) {
      ensureArtifacts(projectId, moduleId);
      wantGraph(projectId, moduleId);
    }
  }, [projectId, moduleId, requirementId, designId, mockupId, ensureArtifacts, ensureModules, wantGraph]);

  const toggle = useCallback(
    (nodeId: string) => {
      const collapsing = expanded.includes(nodeId);
      setExpanded((prev) => {
        if (collapsing) return toggleExpanded(prev, nodeId);
        const withGroups = [...prev, nodeId];
        const match = /^m:([^/]+)\/(.+)$/.exec(nodeId);
        if (match) {
          withGroups.push(groupNodeId(match[1], match[2], "req"));
          withGroups.push(groupNodeId(match[1], match[2], "design"));
        }
        return [...new Set(withGroups)];
      });
      if (collapsing) return;
      // Al expandir también se reintenta tras un error.
      const projectMatch = /^p:(.+)$/.exec(nodeId);
      if (projectMatch) {
        const pid = projectMatch[1];
        if (
          cacheRef.current.modulesByProject[pid] === undefined ||
          cacheRef.current.errorKeys[nodeId] !== undefined
        ) {
          void loadModules(pid);
        }
        return;
      }
      const moduleMatch = /^m:([^/]+)\/(.+)$/.exec(nodeId);
      if (moduleMatch) {
        const key = moduleKey(moduleMatch[1], moduleMatch[2]);
        if (
          cacheRef.current.artifactsByModule[key] === undefined ||
          cacheRef.current.errorKeys[key] !== undefined
        ) {
          void loadArtifacts(moduleMatch[1], moduleMatch[2]);
        }
        return;
      }
      // Expandir un requisito asegura los vínculos de su módulo.
      const artifactMatch = /^a:([^/]+)\/(.+)\/(.+)$/.exec(nodeId);
      if (artifactMatch) {
        wantGraph(artifactMatch[1], artifactMatch[2]);
      }
    },
    [expanded, loadArtifacts, loadModules, wantGraph],
  );

  const reloadProjects = useCallback(() => void loadProjects(), [loadProjects]);
  const retryProject = useCallback((pid: string) => void loadModules(pid), [loadModules]);
  const retryModule = useCallback(
    (pid: string, mid: string) => void loadArtifacts(pid, mid),
    [loadArtifacts],
  );
  const retryGraph = useCallback(
    (pid: string, mid: string) => void loadGraph(pid, mid),
    [loadGraph],
  );

  // Identidad estable: el panel memoiza el bosque sobre este objeto y el
  // árbol no debe reconstruirse (ni mover el foco) en cada render ajeno.
  return useMemo(
    () => ({
      projects,
      projectsLoading,
      projectsError,
      modulesByProject,
      artifactsByModule,
      loadingKeys,
      errorKeys,
      graphsByModule,
      expanded,
      toggle,
      reloadProjects,
      retryProject,
      retryModule,
      retryGraph,
    }),
    [
      projects,
      projectsLoading,
      projectsError,
      modulesByProject,
      artifactsByModule,
      loadingKeys,
      errorKeys,
      graphsByModule,
      expanded,
      toggle,
      reloadProjects,
      retryProject,
      retryModule,
      retryGraph,
    ],
  );
}
