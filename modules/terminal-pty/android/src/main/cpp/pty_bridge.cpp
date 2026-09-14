// JNI bridge: expo.modules.terminalpty.TerminalPtyModule ↔ PtySession.
// Sessions live in a mutex-guarded map keyed by client session id.
#include "pty_session.h"

#include <jni.h>

#include <map>
#include <mutex>
#include <string>

namespace {

std::mutex gMutex;
std::map<std::string, PtySession*> gSessions;

std::string JStringToStd(JNIEnv* env, jstring value) {
  if (!value) return {};
  const char* chars = env->GetStringUTFChars(value, nullptr);
  std::string out = chars ? chars : "";
  if (chars) env->ReleaseStringUTFChars(value, chars);
  return out;
}

PtySession* FindLocked(const std::string& id) {
  auto it = gSessions.find(id);
  return it == gSessions.end() ? nullptr : it->second;
}

// Command output can contain arbitrary bytes (binary diffs, progress bars).
// NewStringUTF requires valid (modified) UTF-8, so sanitize first: invalid
// sequences become U+FFFD instead of risking a JNI crash.
std::string SanitizeUtf8(const std::string& in) {
  std::string out;
  out.reserve(in.size());
  size_t i = 0;
  const size_t n = in.size();
  while (i < n) {
    unsigned char c = static_cast<unsigned char>(in[i]);
    size_t len = 0;
    if (c < 0x80) {
      out.push_back(static_cast<char>(c));
      ++i;
      continue;
    } else if ((c & 0xE0) == 0xC0) {
      len = 2;
    } else if ((c & 0xF0) == 0xE0) {
      len = 3;
    } else if ((c & 0xF8) == 0xF0) {
      len = 4;
    } else {
      out.append("\xEF\xBF\xBD");
      ++i;
      continue;
    }
    if (i + len > n) {
      out.append("\xEF\xBF\xBD");
      break;
    }
    bool ok = true;
    for (size_t k = 1; k < len; ++k) {
      unsigned char cc = static_cast<unsigned char>(in[i + k]);
      if ((cc & 0xC0) != 0x80) {
        ok = false;
        break;
      }
    }
    if (ok) {
      out.append(in, i, len);
      i += len;
    } else {
      out.append("\xEF\xBF\xBD");
      ++i;
    }
  }
  return out;
}

}  // namespace

extern "C" {

JNIEXPORT jint JNICALL
Java_expo_modules_terminalpty_TerminalPtyModule_nativeSpawn(
    JNIEnv* env, jobject thiz, jstring jId, jstring jProotPath,
    jstring jRootfsPath, jstring jInitialCmd, jint cols, jint rows) {
  std::string id = JStringToStd(env, jId);
  std::string prootPath = JStringToStd(env, jProotPath);
  std::string rootfsPath = JStringToStd(env, jRootfsPath);
  std::string initialCmd = JStringToStd(env, jInitialCmd);
  if (id.empty() || prootPath.empty() || rootfsPath.empty()) return -1;

  std::lock_guard<std::mutex> lock(gMutex);
  if (FindLocked(id)) return -2;  // duplicate session id

  auto* session = new PtySession();
  session->id = id;
  env->GetJavaVM(reinterpret_cast<JavaVM**>(&session->jvmRef));
  session->moduleRef = env->NewGlobalRef(thiz);

  auto argv = BuildInteractiveArgv(prootPath, rootfsPath, initialCmd);
  if (PtySpawn(session, argv, {}, cols, rows) != 0) {
    env->DeleteGlobalRef(static_cast<jobject>(session->moduleRef));
    delete session;
    return -3;
  }
  gSessions[id] = session;
  return 0;
}

JNIEXPORT void JNICALL
Java_expo_modules_terminalpty_TerminalPtyModule_nativeWrite(
    JNIEnv* env, jobject, jstring jId, jstring jData) {
  std::string id = JStringToStd(env, jId);
  std::string data = JStringToStd(env, jData);
  std::lock_guard<std::mutex> lock(gMutex);
  if (auto* session = FindLocked(id)) PtyWrite(session, data);
}

JNIEXPORT void JNICALL
Java_expo_modules_terminalpty_TerminalPtyModule_nativeResize(
    JNIEnv* env, jobject, jstring jId, jint cols, jint rows) {
  std::string id = JStringToStd(env, jId);
  std::lock_guard<std::mutex> lock(gMutex);
  if (auto* session = FindLocked(id)) PtyResize(session, cols, rows);
}

JNIEXPORT void JNICALL
Java_expo_modules_terminalpty_TerminalPtyModule_nativeKill(
    JNIEnv* env, jobject, jstring jId) {
  std::string id = JStringToStd(env, jId);
  PtySession* session = nullptr;
  {
    std::lock_guard<std::mutex> lock(gMutex);
    auto it = gSessions.find(id);
    if (it != gSessions.end()) {
      session = it->second;
      gSessions.erase(it);
    }
  }
  if (session) {
    PtyKill(session);
    env->DeleteGlobalRef(static_cast<jobject>(session->moduleRef));
    delete session;
  }
}

// Reaps sessions orphaned by a dead JS runtime (full reload): OnCreate of a
// fresh module instance means no live runtime owns these PTYs anymore, so
// killing them here can never harm a running session. Normal activity
// recreation does NOT recreate the module, so background sessions survive it.
JNIEXPORT void JNICALL
Java_expo_modules_terminalpty_TerminalPtyModule_nativeKillAll(
    JNIEnv* env, jobject) {
  std::map<std::string, PtySession*> doomed;
  {
    std::lock_guard<std::mutex> lock(gMutex);
    doomed.swap(gSessions);
  }
  for (auto& pair : doomed) {
    PtyKill(pair.second);
    env->DeleteGlobalRef(static_cast<jobject>(pair.second->moduleRef));
    delete pair.second;
  }
}

JNIEXPORT jobject JNICALL
Java_expo_modules_terminalpty_TerminalPtyModule_nativeExecuteHeadless(
    JNIEnv* env, jobject, jstring jProotPath, jstring jRootfsPath,
    jstring jCmd, jlong timeoutMs) {
  std::string prootPath = JStringToStd(env, jProotPath);
  std::string rootfsPath = JStringToStd(env, jRootfsPath);
  std::string cmd = JStringToStd(env, jCmd);

  auto argv = BuildHeadlessArgv(prootPath, rootfsPath, cmd);
  HeadlessResult result = PtyExecuteHeadless(argv, {}, (long)timeoutMs);

  jclass mapClass = env->FindClass("java/util/HashMap");
  jmethodID init = env->GetMethodID(mapClass, "<init>", "()V");
  jmethodID put = env->GetMethodID(
      mapClass, "put",
      "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
  jobject map = env->NewObject(mapClass, init);

  jclass intClass = env->FindClass("java/lang/Integer");
  jmethodID intValueOf =
      env->GetStaticMethodID(intClass, "valueOf", "(I)Ljava/lang/Integer;");

  auto putStr = [&](const char* key, const std::string& value) {
    jstring jkey = env->NewStringUTF(key);
    std::string safe = SanitizeUtf8(value);
    jstring jval = env->NewStringUTF(safe.c_str());
    env->CallObjectMethod(map, put, jkey, jval);
    env->DeleteLocalRef(jkey);
    env->DeleteLocalRef(jval);
  };
  putStr("stdout", result.stdoutText);
  putStr("stderr", result.stderrText);
  {
    jstring jkey = env->NewStringUTF("exitCode");
    jobject jval = env->CallStaticObjectMethod(intClass, intValueOf,
                                               (jint)result.exitCode);
    env->CallObjectMethod(map, put, jkey, jval);
    env->DeleteLocalRef(jkey);
    env->DeleteLocalRef(jval);
  }
  return map;
}

}  // extern "C"
