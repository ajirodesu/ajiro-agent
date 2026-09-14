#pragma once

#include <pthread.h>
#include <sys/types.h>

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

// One live forkpty session: master fd + child pid + pump thread.
// All blocking I/O happens on the pump thread; JNI calls only enqueue.
struct PtySession {
  std::string id;
  int masterFd = -1;
  pid_t childPid = -1;
  pthread_t pumpThread = 0;
  std::atomic<bool> running{false};

  // JVM callback refs (global). Set at spawn, released at join.
  void* jvmRef = nullptr;    // JavaVM*
  void* moduleRef = nullptr; // jobject global ref to TerminalPtyModule
};

struct HeadlessResult {
  std::string stdoutText;
  std::string stderrText;
  int exitCode = 127;
};

// Build PRoot argv for an interactive login shell.
std::vector<std::string> BuildInteractiveArgv(const std::string& prootPath,
                                              const std::string& rootfsPath,
                                              const std::string& initialCmd);

// Build PRoot argv for a headless `bash -lc` capture.
std::vector<std::string> BuildHeadlessArgv(const std::string& prootPath,
                                            const std::string& rootfsPath,
                                            const std::string& cmd);

// Spawn + pump lifecycle (implemented in pty_session.cpp).
int PtySpawn(PtySession* session, const std::vector<std::string>& argv,
             const std::vector<std::string>& env, int cols, int rows);
void PtyWrite(PtySession* session, const std::string& data);
void PtyResize(PtySession* session, int cols, int rows);
void PtyKill(PtySession* session);
HeadlessResult PtyExecuteHeadless(const std::vector<std::string>& argv,
                                  const std::vector<std::string>& env,
                                  long timeoutMs);
