import { useQueryClient } from "@tanstack/react-query";
import {
  useObtenerReglas,
  useCrearRegla,
  useEliminarRegla,
  useObtenerMemoria,
  useGuardarMemoria,
  useEliminarMemoria,
  useObtenerHistorial,
  useGuardarHistorial,
  useProcesarIA,
  getObtenerReglasQueryKey,
  getObtenerMemoriaQueryKey,
  getObtenerHistorialQueryKey
} from "@workspace/api-client-react";

// ============================================
// REGLAS HOOKS
// ============================================
export function useReglas() {
  return useObtenerReglas();
}

export function useAddRegla() {
  const qc = useQueryClient();
  return useCrearRegla({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getObtenerReglasQueryKey() });
      }
    }
  });
}

export function useDeleteRegla() {
  const qc = useQueryClient();
  return useEliminarRegla({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getObtenerReglasQueryKey() });
      }
    }
  });
}

// ============================================
// MEMORIA HOOKS
// ============================================
export function useMemoria() {
  return useObtenerMemoria();
}

export function useAddMemoria() {
  const qc = useQueryClient();
  return useGuardarMemoria({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getObtenerMemoriaQueryKey() });
      }
    }
  });
}

export function useDeleteMemoria() {
  const qc = useQueryClient();
  return useEliminarMemoria({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getObtenerMemoriaQueryKey() });
      }
    }
  });
}

// ============================================
// HISTORIAL HOOKS
// ============================================
export function useHistorial() {
  return useObtenerHistorial();
}

export function useAddHistorial() {
  const qc = useQueryClient();
  return useGuardarHistorial({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getObtenerHistorialQueryKey() });
      }
    }
  });
}

// ============================================
// IA HOOKS
// ============================================
export function useAskIA() {
  return useProcesarIA();
}
