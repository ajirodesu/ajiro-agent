// PTY session lifecycle: forkpty spawn, non-blocking pump, resize, signals,
// reaping, fd cleanup. Keeps raw bytes opaque — no ANSI interpretation here.
#include "pty_session.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include <android/log.h>
#include <jni.h>
#include <pty.h>
#include <termios.h>

#define LOG_TAG "TerminalPty"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

static const char* kGuestEnv[] = {
    "HOME=/root",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "TERM=xterm-256color",
    "LANG=C.UTF-8",
    nullptr,
};

std::vector<std::string> BuildInteractiveArgv(const std::string& prootPath,
                                              const std::string& rootfsPath,
                                              const std::string& initialCmd) {
  std::string workspace = rootfsPath + "/workspace";
  std::vector<std::string> argv = {
      prootPath,         "-r",      rootfsPath, "-0", "-w", "/workspace",
      "-b",              "/dev",    "-b",       "/proc",    "-b", "/sys",
      "-b",              workspace + ":/workspace", "--kill-on-exit",
      "/bin/bash",       initialCmd.empty() ? "--login" : initialCmd,
  };
  return argv;
}

std::vector<std::string> BuildHeadlessArgv(const std::string& prootPath,
                                            const std::string& rootfsPath,
                                            const std::string& cmd) {
  std::string workspace = rootfsPath + "/workspace";
  return {
      prootPath,   "-r",      rootfsPath, "-0", "-w", "/workspace",
      "-b",        "/dev",    "-b",       "/proc",    "-b", "/sys",
      "-b",        workspace + ":/workspace", "--kill-on-exit",
      "/bin/bash", "-lc",     cmd,
  };
}

namespace {

void SetNonBlocking(int fd) {
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags >= 0) fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

// Reader thread: pumps masterFd → Kotlin onSessionData, then onSessionExit.
// Attaches to the JVM per-thread and detaches on return.
void* PumpMain(void* arg) {
  auto* session = static_cast<PtySession*>(arg);
  auto* jvm = static_cast<JavaVM*>(session->jvmRef);
  auto moduleGlobal = static_cast<jobject>(session->moduleRef);

  JNIEnv* env = nullptr;
  if (jvm->AttachCurrentThread(&env, nullptr) != JNI_OK) {
    return nullptr;
  }
  jclass cls = env->GetObjectClass(moduleGlobal);
  jmethodID onData =
      env->GetMethodID(cls, "onSessionData", "(Ljava/lang/String;[B)V");
  jmethodID onExit =
      env->GetMethodID(cls, "onSessionExit", "(Ljava/lang/String;I)V");

  char buf[8192];
  while (session->running.load()) {
    fd_set rfds;
    FD_ZERO(&rfds);
    FD_SET(session->masterFd, &rfds);
    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = 100 * 1000;
    int ready = select(session->masterFd + 1, &rfds, nullptr, nullptr, &tv);
    if (ready < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (ready == 0) {
      // Reap check: child gone → drain once more, then exit.
      int status = 0;
      pid_t waited = waitpid(session->childPid, &status, WNOHANG);
      if (waited == session->childPid) {
        session->running.store(false);
        // Best-effort final drain (non-blocking).
        ssize_t n;
        while ((n = read(session->masterFd, buf, sizeof(buf))) > 0) {
          if (onData) {
            jstring jid = env->NewStringUTF(session->id.c_str());
            jbyteArray arr = env->NewByteArray(n);
            env->SetByteArrayRegion(arr, 0, n,
                                    reinterpret_cast<jbyte*>(buf));
            env->CallVoidMethod(moduleGlobal, onData, jid, arr);
            env->DeleteLocalRef(arr);
            env->DeleteLocalRef(jid);
          }
        }
        int code = WIFEXITED(status) ? WEXITSTATUS(status) : 127;
        if (onExit) {
          jstring jid = env->NewStringUTF(session->id.c_str());
          env->CallVoidMethod(moduleGlobal, onExit, jid, code);
          env->DeleteLocalRef(jid);
        }
        break;
      }
      continue;
    }
    ssize_t n = read(session->masterFd, buf, sizeof(buf));
    if (n > 0) {
      if (onData) {
        jstring jid = env->NewStringUTF(session->id.c_str());
        jbyteArray arr = env->NewByteArray(n);
        env->SetByteArrayRegion(arr, 0, n, reinterpret_cast<jbyte*>(buf));
        env->CallVoidMethod(moduleGlobal, onData, jid, arr);
        env->DeleteLocalRef(arr);
        env->DeleteLocalRef(jid);
        if (env->ExceptionCheck()) env->ExceptionClear();
      }
    } else if (n == 0) {
      // EOF: child exited.
      int status = 0;
      waitpid(session->childPid, &status, 0);
      session->running.store(false);
      int code = WIFEXITED(status) ? WEXITSTATUS(status) : 0;
      if (onExit) {
        jstring jid = env->NewStringUTF(session->id.c_str());
        env->CallVoidMethod(moduleGlobal, onExit, jid, code);
        env->DeleteLocalRef(jid);
      }
      break;
    } else if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR &&
               errno != EIO) {
      break;
    }
  }

  jvm->DetachCurrentThread();
  return nullptr;
}

std::vector<char*> ToExecArgv(const std::vector<std::string>& args,
                               std::vector<std::string>& storage) {
  storage = args;
  std::vector<char*> argv;
  for (auto& s : storage) argv.push_back(s.data());
  argv.push_back(nullptr);
  return argv;
}

}  // namespace

int PtySpawn(PtySession* session, const std::vector<std::string>& argv,
             const std::vector<std::string>& /*env*/, int cols, int rows) {
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = static_cast<unsigned short>(cols);
  ws.ws_row = static_cast<unsigned short>(rows);

  pid_t pid = forkpty(&session->masterFd, nullptr, nullptr, &ws);
  if (pid < 0) {
    LOGE("forkpty failed: %s", strerror(errno));
    return -1;
  }
  if (pid == 0) {
    // Child: minimal guest environment, then exec proot.
    for (const char* e : kGuestEnv) putenv(const_cast<char*>(e));
    std::vector<std::string> storage;
    std::vector<char*> execArgv = ToExecArgv(argv, storage);
    execv(execArgv[0], execArgv.data());
    _exit(127);
  }
  session->childPid = pid;
  SetNonBlocking(session->masterFd);
  session->running.store(true);
  if (pthread_create(&session->pumpThread, nullptr, PumpMain, session) != 0) {
    LOGE("pthread_create failed");
    close(session->masterFd);
    session->masterFd = -1;
    kill(pid, SIGKILL);
    waitpid(pid, nullptr, 0);
    session->running.store(false);
    return -1;
  }
  return 0;
}

void PtyWrite(PtySession* session, const std::string& data) {
  if (session->masterFd < 0 || !session->running.load()) return;
  const char* p = data.data();
  size_t left = data.size();
  while (left > 0) {
    ssize_t n = write(session->masterFd, p, left);
    if (n < 0) {
      if (errno == EINTR) continue;
      if (errno == EAGAIN || errno == EWOULDBLOCK) break;
      return;
    }
    p += n;
    left -= static_cast<size_t>(n);
  }
}

void PtyResize(PtySession* session, int cols, int rows) {
  if (session->masterFd < 0) return;
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = static_cast<unsigned short>(cols);
  ws.ws_row = static_cast<unsigned short>(rows);
  ioctl(session->masterFd, TIOCSWINSZ, &ws);
  // Forward SIGWINCH so bash/readline reflow.
  if (session->childPid > 0) kill(session->childPid, SIGWINCH);
}

void PtyKill(PtySession* session) {
  session->running.store(false);
  if (session->childPid > 0) {
    kill(session->childPid, SIGTERM);
    // Grace period, then SIGKILL + reap to prevent orphans/zombies.
    int status = 0;
    for (int i = 0; i < 10; ++i) {
      pid_t w = waitpid(session->childPid, &status, WNOHANG);
      if (w == session->childPid) break;
      usleep(100 * 1000);
    }
    if (waitpid(session->childPid, &status, WNOHANG) != session->childPid) {
      kill(session->childPid, SIGKILL);
      waitpid(session->childPid, &status, 0);
    }
    session->childPid = -1;
  }
  if (session->pumpThread) {
    pthread_join(session->pumpThread, nullptr);
    session->pumpThread = 0;
  }
  if (session->masterFd >= 0) {
    close(session->masterFd);
    session->masterFd = -1;
  }
}

HeadlessResult PtyExecuteHeadless(const std::vector<std::string>& argv,
                                  const std::vector<std::string>& /*env*/,
                                  long timeoutMs) {
  HeadlessResult result;
  int outPipe[2] = {-1, -1};
  int errPipe[2] = {-1, -1};
  if (pipe(outPipe) != 0 || pipe(errPipe) != 0) return result;

  pid_t pid = fork();
  if (pid < 0) {
    close(outPipe[0]);
    close(outPipe[1]);
    close(errPipe[0]);
    close(errPipe[1]);
    return result;
  }
  if (pid == 0) {
    dup2(outPipe[1], STDOUT_FILENO);
    dup2(errPipe[1], STDERR_FILENO);
    close(outPipe[0]);
    close(outPipe[1]);
    close(errPipe[0]);
    close(errPipe[1]);
    for (const char* e : kGuestEnv) putenv(const_cast<char*>(e));
    std::vector<std::string> storage;
    std::vector<char*> execArgv = ToExecArgv(argv, storage);
    execv(execArgv[0], execArgv.data());
    _exit(127);
  }
  close(outPipe[1]);
  close(errPipe[1]);
  SetNonBlocking(outPipe[0]);
  SetNonBlocking(errPipe[0]);

  std::string out, err;
  out.reserve(8192);
  err.reserve(2048);
  long elapsedMs = 0;
  int status = 0;
  bool done = false;
  char buf[4096];
  while (!done && elapsedMs < timeoutMs) {
    fd_set rfds;
    FD_ZERO(&rfds);
    FD_SET(outPipe[0], &rfds);
    FD_SET(errPipe[0], &rfds);
    int maxFd = outPipe[0] > errPipe[0] ? outPipe[0] : errPipe[0];
    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = 50 * 1000;
    select(maxFd + 1, &rfds, nullptr, nullptr, &tv);
    elapsedMs += 50;
    if (FD_ISSET(outPipe[0], &rfds)) {
      ssize_t n = read(outPipe[0], buf, sizeof(buf));
      if (n > 0) {
        if (out.size() < 256 * 1024) out.append(buf, static_cast<size_t>(n));
      }
    }
    if (FD_ISSET(errPipe[0], &rfds)) {
      ssize_t n = read(errPipe[0], buf, sizeof(buf));
      if (n > 0) {
        if (err.size() < 64 * 1024) err.append(buf, static_cast<size_t>(n));
      }
    }
    pid_t w = waitpid(pid, &status, WNOHANG);
    if (w == pid) done = true;
  }
  if (!done) {
    kill(pid, SIGKILL);
    waitpid(pid, &status, 0);
    result.exitCode = 124;
    result.stderrText = "Command timed out.";
  } else {
    result.exitCode = WIFEXITED(status) ? WEXITSTATUS(status) : 127;
  }
  // Final drain.
  ssize_t n;
  while ((n = read(outPipe[0], buf, sizeof(buf))) > 0) {
    if (out.size() < 256 * 1024) out.append(buf, static_cast<size_t>(n));
  }
  while ((n = read(errPipe[0], buf, sizeof(buf))) > 0) {
    if (err.size() < 64 * 1024) err.append(buf, static_cast<size_t>(n));
  }
  close(outPipe[0]);
  close(errPipe[0]);
  result.stdoutText = std::move(out);
  result.stderrText =
      result.stderrText.empty() ? std::move(err) : result.stderrText + err;
  return result;
}
