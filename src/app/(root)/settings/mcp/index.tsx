/**
 * MCP servers — dedicated management screen. Lists every configured server
 * with live status and full actions (toggle, test, OAuth, clear auth, edit,
 * delete), reachable directly from the sidebar (Plugins) or the chat
 * composer's MCP drawer. Independent of the coding page.
 *
 * Author: AjiroDesu
 */
import { useRouter } from "expo-router";
import { ChevronLeft, Plus, Search } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { McpServerRow } from "@/components/settings/mcp/server-row";
import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppState } from "@/hooks/use-app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { isMcpOAuthCanceledError } from "@/modules/mcp/oauth";

export default function McpServersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { ready } = useAppState();
  const {
    clearMcpServerCredentials,
    connectMcpServerOAuth,
    deleteMcpServer,
    mcpServers,
    testMcpServer,
    updateMcpServer,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);

    try {
      await action();
    } catch (actionError) {
      if (isMcpOAuthCanceledError(actionError)) return;
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The MCP action failed. Check the server configuration and try again.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Container
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
      scroll
    >
      <AppHeader
        left={
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => router.back()}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title="MCP servers"
        right={
          <CircleIconButton
            accessibilityLabel="Add server"
            onPress={() => router.push("/settings/mcp/add" as never)}
          >
            <Plus color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
      />

      {!ready ? (
        <Card
          accessibilityLabel="Loading servers"
          className="gap-sp-3 px-sp-4 py-sp-4"
        >
          {[0, 1, 2].map((item) => (
            <View key={item} className="flex-row items-center gap-sp-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <View className="flex-1 gap-sp-2">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </View>
            </View>
          ))}
        </Card>
      ) : (
        <>
          {mcpServers.length === 0 ? (
            <Card className="items-center gap-sp-2 px-sp-4 py-sp-6">
              <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                No servers connected
              </Text>
              <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Connect an MCP server to give the agent additional tools.
              </Text>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {mcpServers.map((server, index) => (
                <View key={server.id}>
                  <McpServerRow
                    busyKey={busyKey}
                    onClearCredentials={() =>
                      runAction(`clear:${server.id}`, async () => {
                        await clearMcpServerCredentials(server.id);
                      })
                    }
                    onConnectOAuth={() =>
                      runAction(`oauth:${server.id}`, async () => {
                        await connectMcpServerOAuth(server.id);
                      })
                    }
                    onDelete={() =>
                      runAction(`delete:${server.id}`, async () => {
                        await deleteMcpServer(server.id);
                      })
                    }
                    onEdit={() =>
                      router.push({
                        pathname: "/settings/mcp/add" as never,
                        params: { serverId: server.id },
                      })
                    }
                    onTest={() =>
                      runAction(`test:${server.id}`, async () => {
                        await testMcpServer(server.id);
                      })
                    }
                    onToggle={(enabled) =>
                      runAction(`toggle:${server.id}`, async () => {
                        await updateMcpServer(server.id, { enabled });
                      })
                    }
                    server={server}
                  />
                  {index < mcpServers.length - 1 ? <Separator /> : null}
                </View>
              ))}
            </Card>
          )}

          <Button
            className="mt-sp-1"
            leftIcon={<Search color={theme.text} size={16} />}
            onPress={() => router.push("/settings/mcp/list" as never)}
            variant="outline"
          >
            Browse server catalog
          </Button>
        </>
      )}

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}
    </Container>
  );
}


