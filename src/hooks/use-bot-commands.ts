/**
 * useBotCommands — dashboard data hook for the built-in bot console.
 * Mirrors the reference hook shape (loading, items, refresh, mutations)
 * against Ajiro Agent's own local bot-service functions.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSQLiteContext } from "expo-sqlite";

import { createRepositories } from "@/core/db/repositories";
import {
  DEFAULT_BOT_ID,
  addCommandRepository,
  createBotCommand,
  deleteBotCommand,
  downloadManualZip,
  fetchEndpointDetection,
  getBotMode,
  listBotCommands,
  removeAllImportedCommands,
  removeAllManualCommands,
  removeCommandRepository,
  resetBotCommands,
  setBotMode,
  toggleBotCommand,
  type BotCommandItem,
} from "@/modules/bot/bot-service";
import type { CodelessCommandConfig } from "../../packages/cat-bot/src/engine/modules/codeless/command-config.types";

export function useBotCommands(botId: string = DEFAULT_BOT_ID) {
  const sqlite = useSQLiteContext();
  const repo = useMemo(
    () => createRepositories(sqlite).botCommandRepository,
    [sqlite],
  );
  const [items, setItems] = useState<BotCommandItem[]>([]);
  const [repositoriesList, setRepositoriesList] = useState<
    { id: string; url: string; lastSyncedAt: string }[]
  >([]);
  const [mode, setModeState] = useState<"bot" | "agent">("agent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [commands, repos, botMode] = await Promise.all([
        listBotCommands(repo, botId),
        repo.listRepositories(botId),
        getBotMode(repo, botId),
      ]);
      setItems(commands);
      setRepositoriesList(repos);
      setModeState(botMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repo, botId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    items,
    repositories: repositoriesList,
    mode,
    loading,
    error,
    refresh,
    create: useCallback(
      async (config: CodelessCommandConfig, apiKey?: string | null) => {
        const created = await createBotCommand(repo, botId, config, apiKey);
        await refresh();
        return created;
      },
      [repo, botId, refresh],
    ),
    remove: useCallback(
      async (name: string) => {
        await deleteBotCommand(repo, botId, name);
        await refresh();
      },
      [repo, botId, refresh],
    ),
    toggle: useCallback(
      async (name: string, enabled: boolean) => {
        await toggleBotCommand(repo, botId, name, enabled);
        await refresh();
      },
      [repo, botId, refresh],
    ),
    fetchEndpoint: useCallback(
      (input: { endpoint: string; body?: string }) => fetchEndpointDetection(input),
      [],
    ),
    addRepository: useCallback(
      async (url: string) => {
        const result = await addCommandRepository(repo, botId, url);
        await refresh();
        return result;
      },
      [repo, botId, refresh],
    ),
    removeRepository: useCallback(
      async (repositoryId: string) => {
        await removeCommandRepository(repo, botId, repositoryId);
        await refresh();
      },
      [repo, botId, refresh],
    ),
    removeAllImported: useCallback(async () => {
      await removeAllImportedCommands(repo, botId);
      await refresh();
    }, [repo, botId, refresh]),
    removeAllManual: useCallback(async () => {
      await removeAllManualCommands(repo, botId);
      await refresh();
    }, [repo, botId, refresh]),
    reset: useCallback(async () => {
      await resetBotCommands(repo, botId);
      await refresh();
    }, [repo, botId, refresh]),
    downloadZip: useCallback(async () => {
      return downloadManualZip(repo, botId);
    }, [repo, botId]),
    setMode: useCallback(
      async (next: "bot" | "agent") => {
        await setBotMode(repo, botId, next);
        setModeState(next);
      },
      [repo, botId],
    ),
  };
}
